import { actionPlanSchema, copilotResponseSchema, type ActionPlan, type CopilotResponse } from "./schemas.js";

function issuePath(path: Array<string | number>): string {
  if (!path.length) return "root";
  return path.map((part) => String(part)).join(".");
}

function formatZodIssues(issues: Array<{ path: Array<string | number>; message: string }>): string[] {
  return issues.map((issue) => `${issuePath(issue.path)}: ${issue.message}`);
}

export function failClosedActionPlan(
  reason = "Planner output failed validation. No actions were executed."
): ActionPlan {
  return {
    goal: "Clarify request safely",
    questions: [reason],
    tool_calls: []
  };
}

export function validateActionPlan(
  raw: unknown
): { ok: true; data: ActionPlan } | { ok: false; data: ActionPlan; errors: string[] } {
  const parsed = actionPlanSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    data: failClosedActionPlan(),
    errors: formatZodIssues(parsed.error.issues)
  };
}

export function failClosedCopilotResponse(
  reason = "Copilot response failed validation. No intervention shown."
): CopilotResponse {
  return {
    intervene: false,
    reason,
    response: "",
    ui_action: null
  };
}

export function validateCopilotResponse(
  raw: unknown
): { ok: true; data: CopilotResponse } | { ok: false; data: CopilotResponse; errors: string[] } {
  const parsed = copilotResponseSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    data: failClosedCopilotResponse(),
    errors: formatZodIssues(parsed.error.issues)
  };
}
