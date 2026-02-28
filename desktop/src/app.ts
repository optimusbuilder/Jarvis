import express from "express";
import type { Env } from "./env.js";
import { allowedToolNames, toolRegistry } from "./tools.js";
import { executeRequestSchema, toolResultSchema } from "./schemas.js";
import { getFrontmostAppName } from "./macos.js";

export function createAgentApp(args: { env: Env }): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    // Localhost agent: allow the extension (chrome-extension://) to post snapshots.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  });
  app.use(express.json({ limit: "1mb" }));

  let lastSnapshot: unknown | null = null;

  app.get("/status", async (_req, res) => {
    const front = await getFrontmostAppName();
    res.json({
      ok: true,
      os: process.platform,
      frontmost_app: front,
      version: "0.1.0"
    });
  });

  app.get("/tools", (_req, res) => {
    res.json({ tools: allowedToolNames });
  });

  app.post("/snapshot", (req, res) => {
    lastSnapshot = req.body ?? null;
    return res.json({ ok: true });
  });

  app.get("/snapshot", (_req, res) => {
    return res.json({ ok: true, snapshot: lastSnapshot });
  });

  app.post("/execute", async (req, res) => {
    const parsed = executeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request" });
    }

    const results: Array<{ tool: string; result: unknown }> = [];
    for (const call of parsed.data.plan.tool_calls) {
      const handler = toolRegistry[call.name];
      if (!handler) {
        results.push({
          tool: call.name,
          result: toolResultSchema.parse({
            success: false,
            observed_state: "",
            error: "tool_not_allowed"
          })
        });
        continue;
      }

      try {
        const out = await handler(call.args, { dryRun: parsed.data.dry_run });
        results.push({ tool: call.name, result: toolResultSchema.parse(out) });
      } catch (err) {
        results.push({
          tool: call.name,
          result: toolResultSchema.parse({
            success: false,
            observed_state: "",
            error: String(err)
          })
        });
      }
    }

    return res.json({ ok: true, goal: parsed.data.plan.goal, results });
  });

  return app;
}
