import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAgentApp } from "../src/app.js";
import type { Env } from "../src/env.js";
import { assessTranscriptQuality } from "../src/voice.js";

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

const fixtureAudioPath = fileURLToPath(new URL("../../speech.mp3", import.meta.url));

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

describe("voice transcript heuristics", () => {
  it("asks for repeat on short transcript", () => {
    const out = assessTranscriptQuality({
      transcript: "uh",
      minWords: 2,
      minChars: 8
    });
    expect(out.quality).toBe("repeat");
  });
});

describe("voice routes", () => {
  it("transcribes audio with injected whisper adapter", async () => {
    const app = createAgentApp({
      env,
      deps: {
        whisperTranscribe: async () => "Open Google Chrome"
      }
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/voice/transcribe",
      body: { audio_path: fixtureAudioPath }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).quality).toBe("good");
    expect((res.body as any).transcript).toBe("Open Google Chrome");
  });

  it("returns needs_repeat without planner call on low quality transcript", async () => {
    let plannerCalled = false;
    const app = createAgentApp({
      env,
      deps: {
        whisperTranscribe: async () => "ok",
        backendPlan: async () => {
          plannerCalled = true;
          throw new Error("planner should not run");
        }
      }
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/voice/run",
      body: { audio_path: fixtureAudioPath, dry_run: true }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).needs_repeat).toBe(true);
    expect(plannerCalled).toBe(false);
  });

  it("runs voice instruction through planner in dry run mode", async () => {
    const app = createAgentApp({
      env,
      deps: {
        whisperTranscribe: async () => "Open Chrome",
        backendPlan: async () => ({
          requestId: "backend-voice-1",
          payload: {
            goal: "Open Google Chrome",
            questions: [],
            tool_calls: [{ name: "open_app", args: { name: "Google Chrome" } }]
          }
        })
      }
    });
    const res = await invokeRoute({
      app,
      method: "post",
      path: "/voice/run",
      headers: { "x-request-id": "voice-run-1" },
      body: { audio_path: fixtureAudioPath, dry_run: true }
    });
    expect(res.status).toBe(200);
    expect((res.body as any).request_id).toBe("voice-run-1");
    expect((res.body as any).backend_request_id).toBe("backend-voice-1");
    expect((res.body as any).needs_repeat).toBe(false);
    expect((res.body as any).results[0].result.success).toBe(true);
    expect(String((res.body as any).results[0].result.observed_state)).toContain("dry_run");
  });

  it("supports ptt start/stop via injected capture adapter", async () => {
    const app = createAgentApp({
      env,
      deps: {
        startPushToTalkCapture: async () => ({
          capture_id: "capture-test-1",
          audio_path: "/tmp/capture-test-1.wav",
          started_at: new Date().toISOString(),
          stop: async () => ({
            audio_path: "/tmp/capture-test-1.wav",
            duration_ms: 1100,
            bytes: 2048
          })
        })
      }
    });

    const start = await invokeRoute({
      app,
      method: "post",
      path: "/voice/ptt/start",
      body: {}
    });
    expect(start.status).toBe(200);
    expect((start.body as any).capture_id).toBe("capture-test-1");

    const stop = await invokeRoute({
      app,
      method: "post",
      path: "/voice/ptt/stop",
      body: { capture_id: "capture-test-1" }
    });
    expect(stop.status).toBe(200);
    expect((stop.body as any).bytes).toBe(2048);
  });

  it("respond route fetches backend tts, writes audio, and can play", async () => {
    let ttsCalled = false;
    let playCalled = false;
    const app = createAgentApp({
      env,
      deps: {
        backendTts: async ({ text }) => {
          ttsCalled = true;
          expect(text).toBe("Acknowledged.");
          return {
            audio: Uint8Array.from([1, 2, 3, 4]).buffer,
            contentType: "audio/mpeg"
          };
        },
        writeAudioFile: async ({ contentType }) => {
          expect(contentType).toBe("audio/mpeg");
          return {
            audioPath: "/tmp/aura-test-response.mp3",
            bytes: 4
          };
        },
        playAudioFile: async ({ audioPath }) => {
          playCalled = true;
          expect(audioPath).toBe("/tmp/aura-test-response.mp3");
        }
      }
    });

    const res = await invokeRoute({
      app,
      method: "post",
      path: "/voice/respond",
      body: { text: "Acknowledged.", speak: true }
    });
    expect(res.status).toBe(200);
    expect(ttsCalled).toBe(true);
    expect(playCalled).toBe(true);
    expect((res.body as any).audio_path).toBe("/tmp/aura-test-response.mp3");
    expect((res.body as any).played).toBe(true);
  });
});
