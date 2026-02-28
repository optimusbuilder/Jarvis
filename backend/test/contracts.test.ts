import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateActionPlan, validateCopilotResponse } from "../src/contracts.js";
import { actionPlanSchema, contextSnapshotSchema, copilotResponseSchema } from "../src/schemas.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "fixtures", "contracts");

function loadFixture(fileName: string): unknown[] {
  const raw = readFileSync(resolve(fixturesDir, fileName), "utf8");
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data)) throw new Error(`Fixture ${fileName} must be an array`);
  return data;
}

function expectAllPass(items: unknown[], validate: (item: unknown) => { success: boolean }): void {
  for (const item of items) {
    expect(validate(item).success).toBe(true);
  }
}

function expectAllFail(
  items: unknown[],
  validate: (item: unknown) => { success: boolean; error?: { issues: unknown[] } }
): void {
  for (const item of items) {
    const parsed = validate(item);
    expect(parsed.success).toBe(false);
    if ("error" in parsed && parsed.error) {
      expect(parsed.error.issues.length).toBeGreaterThan(0);
    }
  }
}

describe("contract fixtures", () => {
  it("accepts known-good action plan fixtures", () => {
    expectAllPass(loadFixture("action-plan.good.json"), (item) => actionPlanSchema.safeParse(item));
  });

  it("rejects known-bad action plan fixtures with explicit issues", () => {
    expectAllFail(loadFixture("action-plan.bad.json"), (item) => actionPlanSchema.safeParse(item));
  });

  it("accepts known-good copilot fixtures", () => {
    expectAllPass(loadFixture("copilot.good.json"), (item) => copilotResponseSchema.safeParse(item));
  });

  it("rejects known-bad copilot fixtures with explicit issues", () => {
    expectAllFail(loadFixture("copilot.bad.json"), (item) => copilotResponseSchema.safeParse(item));
  });

  it("accepts known-good context snapshot fixtures", () => {
    expectAllPass(loadFixture("context-snapshot.good.json"), (item) =>
      contextSnapshotSchema.safeParse(item)
    );
  });

  it("rejects known-bad context snapshot fixtures with explicit issues", () => {
    expectAllFail(loadFixture("context-snapshot.bad.json"), (item) =>
      contextSnapshotSchema.safeParse(item)
    );
  });
});

describe("fail-closed behavior", () => {
  it("returns no tool calls on malformed action plan output", () => {
    const out = validateActionPlan({ goal: 123, tool_calls: "bad" });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.data.tool_calls).toEqual([]);
      expect(out.errors.length).toBeGreaterThan(0);
    }
  });

  it("returns non-intervention response on malformed copilot output", () => {
    const out = validateCopilotResponse({ intervene: "sometimes" });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.data.intervene).toBe(false);
      expect(out.errors.length).toBeGreaterThan(0);
    }
  });
});
