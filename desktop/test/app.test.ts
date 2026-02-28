import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { createAgentApp } from "../src/app.js";

type RouteMethod = "get" | "post";

type InvokeResult = {
  status: number;
  body: unknown;
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

  const out: InvokeResult = { status: 200, body: null };
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
  AURA_BACKEND_URL: "http://127.0.0.1:8080",
  AURA_BACKEND_AUTH_TOKEN: "x".repeat(32),
  WHISPER_CPP_BIN: "whisper-cli"
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
  });
});
