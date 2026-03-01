import express from "express";
import type { Env } from "./env.js";
import { backendPlan } from "./backendClient.js";
import {
  actionPlanSchema,
  executeRequestSchema,
  runRequestSchema,
  toolResultSchema,
  type ActionPlan
} from "./schemas.js";
import { allowedToolNames, executeToolCall, toolSchemas } from "./tools.js";
import { getFrontmostAppName, getPermissionStatus } from "./macos.js";
import { appendAuditLog, ensureRequestId } from "./logging.js";

type AuraRequest = express.Request & { aura_request_id?: string };

function withRequestId(req: AuraRequest, res: express.Response, next: express.NextFunction): void {
  req.aura_request_id = ensureRequestId(req, res);
  next();
}

function failClosedPlan(reason: string): ActionPlan {
  return {
    goal: "Clarify request safely",
    questions: [reason],
    tool_calls: []
  };
}

async function executePlan(args: {
  plan: { goal: string; tool_calls: Array<{ name: string; args: Record<string, unknown> }> };
  dryRun: boolean;
}) {
  const results: Array<{
    requested_tool: string;
    normalized_tool: string;
    result: unknown;
  }> = [];

  for (const call of args.plan.tool_calls) {
    const out = await executeToolCall({ call, dryRun: args.dryRun });
    results.push({
      requested_tool: out.requested_tool,
      normalized_tool: out.normalized_tool,
      result: toolResultSchema.parse(out.result)
    });
  }

  return results;
}

async function writeAudit(args: {
  env: Env;
  requestId: string;
  event: string;
  data: Record<string, unknown>;
}): Promise<void> {
  try {
    await appendAuditLog({
      env: args.env,
      request_id: args.requestId,
      event: args.event,
      data: args.data
    });
  } catch {
    // audit log is best effort in v1
  }
}

export function createAgentApp(args: { env: Env }): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, x-request-id");
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(withRequestId);

  let lastSnapshot: unknown | null = null;

  app.get("/status", async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const front = await getFrontmostAppName();
    const permissions = await getPermissionStatus();
    const payload = {
      ok: true,
      os: process.platform,
      frontmost_app: front,
      version: args.env.AURA_AGENT_VERSION,
      permissions
    };
    await writeAudit({
      env: args.env,
      requestId,
      event: "agent_status",
      data: { frontmost_app: front, permissions }
    });
    res.json(payload);
  });

  app.get("/tools", async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const payload = { tools: allowedToolNames, schemas: toolSchemas };
    await writeAudit({
      env: args.env,
      requestId,
      event: "agent_tools",
      data: { tool_count: allowedToolNames.length }
    });
    res.json(payload);
  });

  app.post("/snapshot", async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    lastSnapshot = req.body ?? null;
    await writeAudit({
      env: args.env,
      requestId,
      event: "snapshot_received",
      data: { has_snapshot: lastSnapshot != null }
    });
    return res.json({ ok: true });
  });

  app.get("/snapshot", (_req, res) => {
    return res.json({ ok: true, snapshot: lastSnapshot });
  });

  app.post("/execute", async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const parsed = executeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      await writeAudit({
        env: args.env,
        requestId,
        event: "execute_invalid_request",
        data: { issues: parsed.error.issues.length }
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    const results = await executePlan({
      plan: parsed.data.plan,
      dryRun: parsed.data.dry_run
    });
    const blockedCount = results.filter((item) => {
      const result = item.result as { error: string | null };
      return result.error === "tool_not_allowed";
    }).length;

    await writeAudit({
      env: args.env,
      requestId,
      event: "execute_completed",
      data: {
        dry_run: parsed.data.dry_run,
        goal: parsed.data.plan.goal,
        tool_calls: parsed.data.plan.tool_calls.map((call) => call.name),
        blocked_count: blockedCount,
        result_count: results.length
      }
    });

    return res.json({
      ok: true,
      request_id: requestId,
      goal: parsed.data.plan.goal,
      results
    });
  });

  app.post("/run", async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const parsed = runRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      await writeAudit({
        env: args.env,
        requestId,
        event: "run_invalid_request",
        data: { issues: parsed.error.issues.length }
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    const front = await getFrontmostAppName();
    let backendRequestId: string | null = null;
    let plan: ActionPlan = failClosedPlan("Planner output was invalid; no actions were executed.");

    try {
      const planned = await backendPlan({
        env: args.env,
        instruction: parsed.data.instruction,
        desktopState: {
          os: "macos",
          frontmost_app: front ?? "unknown"
        },
        contextSnapshot: parsed.data.context_snapshot,
        requestId
      });
      backendRequestId = planned.requestId;
      const validated = actionPlanSchema.safeParse(planned.payload);
      if (validated.success) {
        plan = validated.data;
      } else {
        plan = failClosedPlan("Planner output failed schema validation; no actions were executed.");
      }
    } catch (err) {
      await writeAudit({
        env: args.env,
        requestId,
        event: "run_planner_failed",
        data: { error: String(err) }
      });
      return res.status(502).json({ error: "planner_failed", message: String(err) });
    }

    const results = await executePlan({
      plan,
      dryRun: parsed.data.dry_run
    });

    await writeAudit({
      env: args.env,
      requestId,
      event: "run_completed",
      data: {
        backend_request_id: backendRequestId,
        dry_run: parsed.data.dry_run,
        instruction_chars: parsed.data.instruction.length,
        goal: plan.goal,
        tool_calls: plan.tool_calls.map((call) => call.name),
        result_count: results.length
      }
    });

    return res.json({
      ok: true,
      request_id: requestId,
      backend_request_id: backendRequestId,
      plan,
      results
    });
  });

  return app;
}
