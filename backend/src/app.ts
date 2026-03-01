import express from "express";
import type { Env } from "./env.js";
import { requireAuth } from "./auth.js";
import { copilotResponseSchema, planRequestSchema, ttsRequestSchema } from "./schemas.js";
import type { VertexPlanner } from "./vertex.js";
import { elevenLabsTts } from "./elevenlabs.js";
import { generateSilentWav } from "./stubAudio.js";
import { redactContextSnapshot } from "./redaction.js";
import { validateActionPlan } from "./contracts.js";
import { ensureRequestId, logError, logInfo } from "./logging.js";

type AuraRequest = express.Request & { aura_request_id?: string };
type TtsProvider = typeof elevenLabsTts;

type AppDependencies = {
  ttsProvider?: TtsProvider;
};

function withRequestId(req: AuraRequest, res: express.Response, next: express.NextFunction): void {
  req.aura_request_id = ensureRequestId(req, res);
  next();
}

export function createApp(args: {
  env: Env;
  planner: VertexPlanner;
  deps?: AppDependencies;
}): express.Express {
  const app = express();
  const ttsProvider = args.deps?.ttsProvider ?? elevenLabsTts;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (req, res) => {
    const requestId = ensureRequestId(req, res);
    logInfo("healthz", { request_id: requestId });
    res.json({
      ok: true,
      service: "aura-backend",
      version: args.env.AURA_BACKEND_VERSION,
      ts: new Date().toISOString()
    });
  });

  app.post("/plan", withRequestId, requireAuth(args.env), async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const parsed = planRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      logError("plan_invalid_request", {
        request_id: requestId,
        issues: parsed.error.issues.length
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    logInfo("plan_request", {
      request_id: requestId,
      planner_mode: args.env.AURA_PLANNER_MODE,
      instruction_chars: parsed.data.instruction.length,
      has_context: parsed.data.context_snapshot != null,
      has_state: parsed.data.desktop_state != null
    });

    try {
      const safeContext = parsed.data.context_snapshot
        ? redactContextSnapshot(parsed.data.context_snapshot).snapshot
        : undefined;
      const rawPlan = await args.planner.plan({
        instruction: parsed.data.instruction,
        context: safeContext,
        state: parsed.data.desktop_state,
        request_id: requestId
      });
      const validated = validateActionPlan(rawPlan);
      if (!validated.ok) {
        logError("plan_invalid_planner_output", {
          request_id: requestId,
          errors: validated.errors
        });
      }
      logInfo("plan_response", {
        request_id: requestId,
        tool_calls: validated.data.tool_calls.length,
        questions: validated.data.questions.length
      });
      return res.json(validated.data);
    } catch (err) {
      logError("plan_failed", {
        request_id: requestId,
        error: String(err)
      });
      return res.status(502).json({ error: "planner_failed", message: String(err) });
    }
  });

  app.post("/copilot", withRequestId, requireAuth(args.env), async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    // Skeleton: deterministic fail-closed default until we implement scoring + prompting.
    const safe = copilotResponseSchema.parse({
      intervene: false,
      reason: "Copilot not enabled yet.",
      response: "",
      ui_action: null
    });
    logInfo("copilot_response", { request_id: requestId, intervene: safe.intervene });
    return res.json(safe);
  });

  app.post("/tts", withRequestId, requireAuth(args.env), async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const parsed = ttsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      logError("tts_invalid_request", {
        request_id: requestId,
        issues: parsed.error.issues.length
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    if (args.env.AURA_TTS_MODE !== "elevenlabs") {
      const wav = generateSilentWav({ seconds: 0.35 });
      res.setHeader("content-type", "audio/wav");
      logInfo("tts_stub_response", {
        request_id: requestId,
        text_chars: parsed.data.text.length
      });
      return res.status(200).send(wav);
    }

    const voiceId = parsed.data.voice_id ?? args.env.ELEVENLABS_VOICE_ID;
    if (!voiceId) return res.status(500).json({ error: "tts_not_configured" });

    try {
      const out = await ttsProvider({ env: args.env, voiceId, text: parsed.data.text });
      res.setHeader("content-type", out.contentType);
      logInfo("tts_response", { request_id: requestId, content_type: out.contentType });
      return res.status(200).send(out.audio);
    } catch (err) {
      logError("tts_failed", { request_id: requestId, error: String(err) });
      return res.status(502).json({ error: "tts_failed", message: String(err) });
    }
  });

  return app;
}
