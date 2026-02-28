import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { createAgentApp } from "../src/app.js";

const env: Env = {
  PORT: 8765,
  AURA_BACKEND_URL: "https://example.com",
  AURA_BACKEND_AUTH_TOKEN: "x".repeat(32),
  WHISPER_CPP_BIN: "whisper-cli"
};

describe("desktop agent app", () => {
  it("status returns ok", async () => {
    const app = createAgentApp({ env });
    const res = await request(app).get("/status");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("tools returns tool list", async () => {
    const app = createAgentApp({ env });
    const res = await request(app).get("/tools");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tools)).toBe(true);
  });

  it("execute blocks unknown tools", async () => {
    const app = createAgentApp({ env });
    const res = await request(app)
      .post("/execute")
      .send({
        dry_run: true,
        plan: { goal: "x", questions: [], tool_calls: [{ name: "rm_rf", args: {} }] }
      });
    expect(res.status).toBe(200);
    expect(res.body.results[0].result.error).toBe("tool_not_allowed");
  });
});

