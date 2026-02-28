import type { Server } from "node:http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Env } from "../src/env.js";
import type { VertexPlanner } from "../src/vertex.js";

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

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    PORT: 8080,
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

describe("backend app", () => {
  it("healthz returns ok", async () => {
    const app = createApp({ env: makeEnv(), planner: stubPlanner });
    const server = await listenOnLocalhost(app);
    try {
      const res = await request(server).get("/healthz");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("plan requires auth when token configured", async () => {
    const app = createApp({
      env: makeEnv({ AURA_BACKEND_AUTH_TOKEN: "x".repeat(32) }),
      planner: stubPlanner
    });
    const server = await listenOnLocalhost(app);
    try {
      const res = await request(server).post("/plan").send({ instruction: "hi" });
      expect(res.status).toBe(401);
    } finally {
      await closeServer(server);
    }
  });

  it("plan returns plan when authed", async () => {
    const token = "x".repeat(32);
    const app = createApp({
      env: makeEnv({ AURA_BACKEND_AUTH_TOKEN: token }),
      planner: stubPlanner
    });
    const server = await listenOnLocalhost(app);
    try {
      const res = await request(server)
        .post("/plan")
        .set("authorization", `Bearer ${token}`)
        .send({ instruction: "hi" });
      expect(res.status).toBe(200);
      expect(res.body.goal).toBe("test");
    } finally {
      await closeServer(server);
    }
  });
});
