import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Env } from "../src/env.js";
import type { VertexPlanner } from "../src/vertex.js";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    PORT: 8080,
    GOOGLE_CLOUD_PROJECT: "test",
    GOOGLE_CLOUD_REGION: "us-central1",
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
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("plan requires auth when token configured", async () => {
    const app = createApp({
      env: makeEnv({ AURA_BACKEND_AUTH_TOKEN: "x".repeat(32) }),
      planner: stubPlanner
    });
    const res = await request(app).post("/plan").send({ instruction: "hi" });
    expect(res.status).toBe(401);
  });

  it("plan returns plan when authed", async () => {
    const token = "x".repeat(32);
    const app = createApp({
      env: makeEnv({ AURA_BACKEND_AUTH_TOKEN: token }),
      planner: stubPlanner
    });
    const res = await request(app)
      .post("/plan")
      .set("authorization", `Bearer ${token}`)
      .send({ instruction: "hi" });
    expect(res.status).toBe(200);
    expect(res.body.goal).toBe("test");
  });
});

