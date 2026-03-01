import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { createAgentApp } from "../src/app.js";

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

const env: Env = {
  PORT: 8765,
  AURA_AGENT_VERSION: "test",
  AURA_AUDIT_LOG_PATH: "logs/test-agent.audit.log",
  AURA_BACKEND_URL: "http://127.0.0.1:8080",
  AURA_BACKEND_AUTH_TOKEN: "x".repeat(32),
  WHISPER_CPP_BIN: "whisper-cli",
  WHISPER_MODEL_PATH: undefined,
  WHISPER_DEFAULT_LANGUAGE: "en",
  WHISPER_NO_GPU: true,
  WHISPER_TIMEOUT_MS: 120000,
  AURA_STT_MIN_WORDS: 2,
  AURA_STT_MIN_CHARS: 8,
  AURA_BROWSER_MODE: "http",
  AURA_BROWSER_TIMEOUT_MS: 15000,
  AURA_BROWSER_HEADLESS: true,
  AURA_ALLOWED_PATHS: undefined,
  AURA_SEARCH_MAX_SCAN: 5000,
  AURA_AUDIO_PLAYER_CMD: undefined
};

describe("desktop agent app", () => {
  it("status returns ok", async () => {
    const app = createAgentApp({ env });
    const res = await invokeRoute({ app, method: "get", path: "/status" });
    expect(res.status).toBe(200);
    expect((res.body as any).ok).toBe(true);
  });

  it("tools returns tool list", async () => {
    const app = createAgentApp({ env });
    const res = await invokeRoute({ app, method: "get", path: "/tools" });
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as any).tools)).toBe(true);
    expect((res.body as any).schemas.open_app).toBeTruthy();
    expect((res.body as any).tools).toContain("browser_go");
    expect((res.body as any).tools).toContain("create_folder");
    expect((res.body as any).tools).toContain("trash_path");
    expect((res.body as any).tools).toContain("focus_app");
    expect((res.body as any).tools).toContain("press_key");
  });

  it("execute blocks unknown tools", async () => {
    const app = createAgentApp({ env });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/execute",
      body: {
        dry_run: true,
        plan: { goal: "x", questions: [], tool_calls: [{ name: "rm_rf", args: {} }] }
      }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).results[0].result.error).toBe("tool_not_allowed");
    expect((res.body as any).results[0].result.observed_state).toContain("blocked");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("execute accepts known safe tool in dry run", async () => {
    const app = createAgentApp({ env });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/execute",
      headers: { "x-request-id": "desktop-p2-test" },
      body: {
        dry_run: true,
        plan: {
          goal: "open chrome",
          questions: [],
          tool_calls: [{ name: "open_app", args: { name: "Google Chrome" } }]
        }
      }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).request_id).toBe("desktop-p2-test");
    expect((res.body as any).results[0].result.success).toBe(true);
    expect((res.body as any).results[0].result.observed_state).toContain("dry_run");
  });

  it("execute normalizes compatible tool aliases", async () => {
    const app = createAgentApp({ env });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/execute",
      body: {
        dry_run: true,
        plan: {
          goal: "open chrome",
          questions: [],
          tool_calls: [{ name: "open_application", args: { app_name: "Google Chrome" } }]
        }
      }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).results[0].normalized_tool).toBe("open_app");
    expect((res.body as any).results[0].result.success).toBe(true);
  });

  it("trash_path requires confirmation for live runs", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "aura-p7-app-"));
    const filePath = path.join(tmpRoot, "trash-me.txt");
    await writeFile(filePath, "phase7");

    const previousAllowedPaths = process.env.AURA_ALLOWED_PATHS;
    process.env.AURA_ALLOWED_PATHS = tmpRoot;

    try {
      const app = createAgentApp({ env });
      const blocked = await invokeRoute({
        app,
        method: "post",
        path: "/execute",
        body: {
          dry_run: false,
          plan: {
            goal: "trash without confirmation",
            questions: [],
            tool_calls: [{ name: "trash_path", args: { path: filePath } }]
          }
        }
      });
      expect(blocked.status).toBe(200);
      expect((blocked.body as any).results[0].result.error).toBe("confirmation_required");

      const allowed = await invokeRoute({
        app,
        method: "post",
        path: "/execute",
        body: {
          dry_run: false,
          plan: {
            goal: "confirm and trash",
            questions: [],
            tool_calls: [
              { name: "confirm_action", args: { reason: "Delete temp test file safely" } },
              { name: "trash_path", args: { path: filePath } }
            ]
          }
        }
      });

      expect(allowed.status).toBe(200);
      expect((allowed.body as any).results[0].normalized_tool).toBe("confirm_action");
      expect((allowed.body as any).results[1].normalized_tool).toBe("trash_path");
      expect((allowed.body as any).results[1].result.success).toBe(true);
      await expect(access(filePath)).rejects.toThrow();
    } finally {
      if (previousAllowedPaths === undefined) delete process.env.AURA_ALLOWED_PATHS;
      else process.env.AURA_ALLOWED_PATHS = previousAllowedPaths;
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("kill switch blocks execution until disabled", async () => {
    const app = createAgentApp({ env });

    const enabled = await invokeRoute({
      app,
      method: "post",
      path: "/control/kill-switch",
      body: { active: true, reason: "phase8 test" }
    });
    expect(enabled.status).toBe(200);
    expect((enabled.body as any).kill_switch_active).toBe(true);

    const blocked = await invokeRoute({
      app,
      method: "post",
      path: "/execute",
      body: {
        dry_run: true,
        plan: {
          goal: "should be blocked",
          questions: [],
          tool_calls: [{ name: "open_app", args: { name: "TextEdit" } }]
        }
      }
    });
    expect(blocked.status).toBe(200);
    expect((blocked.body as any).aborted).toBe(true);
    expect((blocked.body as any).results[0].result.error).toBe("kill_switch_active");

    const disabled = await invokeRoute({
      app,
      method: "post",
      path: "/control/kill-switch",
      body: { active: false }
    });
    expect(disabled.status).toBe(200);
    expect((disabled.body as any).kill_switch_active).toBe(false);

    const allowed = await invokeRoute({
      app,
      method: "post",
      path: "/execute",
      body: {
        dry_run: true,
        plan: {
          goal: "should be allowed",
          questions: [],
          tool_calls: [{ name: "open_app", args: { name: "TextEdit" } }]
        }
      }
    });
    expect(allowed.status).toBe(200);
    expect((allowed.body as any).aborted).toBe(false);
    expect((allowed.body as any).results[0].result.success).toBe(true);
  });

  it("run rejects invalid requests before planner call", async () => {
    const app = createAgentApp({ env });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/run",
      body: { dry_run: true }
    });
    expect(res.status).toBe(400);
    expect((res.body as any).error).toBe("invalid_request");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });
});
