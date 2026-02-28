import type { Server } from "node:http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { createAgentApp } from "../src/app.js";

async function listenOnLocalhost(app: any): Promise<Server> {
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
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
    const server = await listenOnLocalhost(app);
    try {
      const res = await request(server).get("/status");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("tools returns tool list", async () => {
    const app = createAgentApp({ env });
    const server = await listenOnLocalhost(app);
    try {
      const res = await request(server).get("/tools");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.tools)).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("execute blocks unknown tools", async () => {
    const app = createAgentApp({ env });
    const server = await listenOnLocalhost(app);
    try {
      const res = await request(server)
        .post("/execute")
        .send({
          dry_run: true,
          plan: { goal: "x", questions: [], tool_calls: [{ name: "rm_rf", args: {} }] }
        });
      expect(res.status).toBe(200);
      expect(res.body.results[0].result.error).toBe("tool_not_allowed");
    } finally {
      await closeServer(server);
    }
  });
});
