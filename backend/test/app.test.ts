import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createLocalPlanner } from "../src/localPlanner.js";
import type { Env } from "../src/env.js";
import type { VertexPlanner } from "../src/vertex.js";

type RouteMethod = "get" | "post";

type InvokeResult = {
  status: number;
  body: unknown;
  headers: Record<string, string>;
};

async function invokeRoute(args: {
  app: any;
  method: RouteMethod;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<InvokeResult> {
  const layer = args.app._router?.stack?.find(
    (entry: any) => entry?.route?.path === args.path && entry?.route?.methods?.[args.method]
  );
  if (!layer) throw new Error(`Route ${args.method.toUpperCase()} ${args.path} not found`);

  const handlers: Array<(req: any, res: any, next: (err?: unknown) => void) => unknown> =
    layer.route.stack.map((entry: any) => entry.handle);

  const requestHeaders = Object.fromEntries(
    Object.entries(args.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );

  const req: any = {
    method: args.method.toUpperCase(),
    path: args.path,
    body: args.body ?? {},
    headers: requestHeaders,
    header(name: string): string | undefined {
      return this.headers[name.toLowerCase()];
    },
    get(name: string): string | undefined {
      return this.headers[name.toLowerCase()];
    }
  };

  const out: InvokeResult = { status: 200, body: null, headers: {} };
  let sent = false;

  const res: any = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(payload: unknown) {
      out.body = payload;
      sent = true;
      return this;
    },
    send(payload: unknown) {
      out.body = payload;
      sent = true;
      return this;
    },
    setHeader(name: string, value: string) {
      out.headers[name.toLowerCase()] = value;
    }
  };

  for (const handler of handlers) {
    let nextCalled = false;
    let settled = false;
    await new Promise<void>((resolve, reject) => {
      const next = (err?: unknown) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else {
          nextCalled = true;
          resolve();
        }
      };
      Promise.resolve(handler(req, res, next))
        .then(() => {
          if (!settled) {
            settled = true;
            resolve();
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
    });
    if (sent || !nextCalled) break;
  }

  return out;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    PORT: 8080,
    AURA_BACKEND_VERSION: "test",
    AURA_PLANNER_MODE: "local",
    AURA_TTS_MODE: "stub",
    GOOGLE_CLOUD_PROJECT: "test",
    GOOGLE_CLOUD_LOCATION: "global",
    AURA_GEMINI_MODEL: "gemini-test",
    ...overrides
  };
}

const stubPlanner: VertexPlanner = {
  async plan() {
    return { goal: "test", questions: [], tool_calls: [] };
  }
};

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "session-1",
    url: "https://example.com/form",
    domain: "example.com",
    page_type: "form",
    page_title: "Application Form",
    visible_text_chunks: [
      { id: "c1", text: "Describe impact achieved improved outcomes", source: "label" },
      { id: "c2", text: "Use measurable metrics where possible", source: "p" }
    ],
    active_element: {
      kind: "textarea",
      label: "Impact statement",
      value_length: 0
    },
    form_fields: [
      {
        field_id: "impact",
        label: "Impact statement",
        kind: "textarea",
        required: true,
        is_sensitive: false,
        answered: false
      }
    ],
    user_actions: [
      { type: "cursor_idle", ms: 6200 },
      { type: "repeated_edit", count: 4 },
      { type: "tab_switch", from_domain: "example.com", to_domain: "example.com" }
    ],
    hesitation_score: 0.82,
    timestamp: new Date().toISOString(),
    ...overrides
  };
}

describe("backend app", () => {
  it("healthz returns ok", async () => {
    const app = createApp({ env: makeEnv(), planner: stubPlanner });
    const res = await invokeRoute({ app, method: "get", path: "/healthz" });
    expect(res.status).toBe(200);
    expect((res.body as any).ok).toBe(true);
    expect((res.body as any).version).toBe("test");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("plan requires auth when token configured", async () => {
    const app = createApp({
      env: makeEnv({ AURA_BACKEND_AUTH_TOKEN: "x".repeat(32) }),
      planner: stubPlanner
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/plan",
      body: { instruction: "hi" }
    });
    expect(res.status).toBe(401);
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("plan returns plan when authed", async () => {
    const token = "x".repeat(32);
    const app = createApp({
      env: makeEnv({ AURA_BACKEND_AUTH_TOKEN: token }),
      planner: stubPlanner
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/plan",
      headers: { authorization: `Bearer ${token}` },
      body: { instruction: "hi" }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).goal).toBe("test");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("plan preserves provided request id", async () => {
    const app = createApp({ env: makeEnv(), planner: stubPlanner });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/plan",
      headers: { "x-request-id": "req-phase1-123" },
      body: { instruction: "Open Chrome" }
    });
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBe("req-phase1-123");
  });

  it("local planner handles open chrome and search compound command", async () => {
    const app = createApp({
      env: makeEnv(),
      planner: createLocalPlanner()
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/plan",
      body: { instruction: "Open Chrome and search for the latest news on Iran" }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).tool_calls?.[0]).toEqual({
      name: "open_app",
      args: { name: "Google Chrome" }
    });
    expect((res.body as any).tool_calls?.[1]?.name).toBe("open_url");
    expect((res.body as any).tool_calls?.[1]?.args?.url).toContain("https://www.google.com/search?q=");
  });

  it("local planner handles search commands directly", async () => {
    const app = createApp({
      env: makeEnv(),
      planner: createLocalPlanner()
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/plan",
      body: { instruction: "Search for whisper cpp setup" }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).tool_calls).toEqual([
      {
        name: "open_url",
        args: { url: "https://www.google.com/search?q=whisper%20cpp%20setup" }
      }
    ]);
  });

  it("plan fails closed on malformed planner output", async () => {
    const app = createApp({
      env: makeEnv(),
      planner: {
        async plan() {
          return { unexpected: true };
        }
      }
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/plan",
      body: { instruction: "hi" }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).tool_calls).toEqual([]);
    expect(Array.isArray((res.body as any).questions)).toBe(true);
    expect((res.body as any).questions[0]).toContain("No actions were executed");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("copilot returns grounded intervention for high-friction form context", async () => {
    const app = createApp({ env: makeEnv(), planner: stubPlanner });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/copilot",
      body: {
        context_snapshot: makeSnapshot()
      }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).intervene).toBe(true);
    expect(typeof (res.body as any).reason).toBe("string");
    expect((res.body as any).reason.length).toBeGreaterThan(10);
    expect((res.body as any).reason).toContain("friction");
    expect((res.body as any).response.length).toBeGreaterThan(10);
  });

  it("copilot stays silent on sensitive domains", async () => {
    const app = createApp({ env: makeEnv(), planner: stubPlanner });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/copilot",
      body: {
        context_snapshot: makeSnapshot({
          domain: "accounts.google.com",
          url: "https://accounts.google.com/signin"
        })
      }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).intervene).toBe(false);
    expect((res.body as any).reason).toContain("Sensitive domain");
  });

  it("copilot feedback endpoint records accepts and dismisses per session", async () => {
    const app = createApp({ env: makeEnv(), planner: stubPlanner });
    const acceptRes = await invokeRoute({
      app,
      method: "post",
      path: "/copilot/feedback",
      body: {
        session_id: "session-abc",
        action: "accept",
        suggestion_kind: "form"
      }
    });
    expect(acceptRes.status).toBe(200);
    expect((acceptRes.body as any).ok).toBe(true);
    expect((acceptRes.body as any).stats.accepts).toBe(1);
    expect((acceptRes.body as any).stats.dismisses).toBe(0);

    const dismissRes = await invokeRoute({
      app,
      method: "post",
      path: "/copilot/feedback",
      body: {
        session_id: "session-abc",
        action: "dismiss",
        suggestion_kind: "form"
      }
    });
    expect(dismissRes.status).toBe(200);
    expect((dismissRes.body as any).stats.accepts).toBe(1);
    expect((dismissRes.body as any).stats.dismisses).toBe(1);
  });

  it("copilot feedback requires auth when token configured", async () => {
    const app = createApp({
      env: makeEnv({ AURA_BACKEND_AUTH_TOKEN: "x".repeat(32) }),
      planner: stubPlanner
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/copilot/feedback",
      body: {
        session_id: "session-locked",
        action: "accept"
      }
    });
    expect(res.status).toBe(401);
  });

  it("tts requires auth when token configured", async () => {
    const app = createApp({
      env: makeEnv({ AURA_BACKEND_AUTH_TOKEN: "x".repeat(32) }),
      planner: stubPlanner
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/tts",
      body: { text: "hello" }
    });
    expect(res.status).toBe(401);
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("tts returns stub audio when mode is stub", async () => {
    const app = createApp({
      env: makeEnv({ AURA_TTS_MODE: "stub" }),
      planner: stubPlanner
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/tts",
      body: { text: "hello world" }
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/wav");
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).byteLength).toBeGreaterThan(100);
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("tts returns provider audio when mode is elevenlabs", async () => {
    let called = false;
    const app = createApp({
      env: makeEnv({
        AURA_TTS_MODE: "elevenlabs",
        ELEVENLABS_VOICE_ID: "voice-123"
      }),
      planner: stubPlanner,
      deps: {
        ttsProvider: async ({ voiceId, text }) => {
          called = true;
          expect(voiceId).toBe("voice-123");
          expect(text).toBe("ack now");
          return {
            contentType: "audio/mpeg",
            audio: Buffer.from([1, 2, 3, 4, 5])
          };
        }
      }
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/tts",
      body: { text: "ack now" }
    });
    expect(res.status).toBe(200);
    expect(called).toBe(true);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).byteLength).toBe(5);
  });
});
