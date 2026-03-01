import express from "express";
import type { Env } from "./env.js";
import { requireAuth } from "./auth.js";
import { copilotFeedbackSchema, copilotRequestSchema, planRequestSchema, ttsRequestSchema } from "./schemas.js";
import type { VertexPlanner } from "./vertex.js";
import { elevenLabsTts } from "./elevenlabs.js";
import { generateSilentWav } from "./stubAudio.js";
import { redactContextSnapshot } from "./redaction.js";
import { validateActionPlan, validateCopilotResponse } from "./contracts.js";
import { ensureRequestId, logError, logInfo } from "./logging.js";
import { decideCopilot } from "./copilotEngine.js";

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
  const copilotFeedbackBySession = new Map<string, { accepts: number; dismisses: number; last_action_at: string }>();

  function feedbackForSession(sessionId: string | undefined): { accepts: number; dismisses: number } | undefined {
    if (!sessionId) return undefined;
    const existing = copilotFeedbackBySession.get(sessionId);
    if (!existing) return undefined;
    return { accepts: existing.accepts, dismisses: existing.dismisses };
  }

  function recordFeedback(args: { sessionId: string; action: "accept" | "dismiss"; timestamp: string }): {
    accepts: number;
    dismisses: number;
    total: number;
  } {
    const existing = copilotFeedbackBySession.get(args.sessionId) ?? {
      accepts: 0,
      dismisses: 0,
      last_action_at: args.timestamp
    };
    if (args.action === "accept") existing.accepts += 1;
    else existing.dismisses += 1;
    existing.last_action_at = args.timestamp;
    copilotFeedbackBySession.set(args.sessionId, existing);
    return {
      accepts: existing.accepts,
      dismisses: existing.dismisses,
      total: existing.accepts + existing.dismisses
    };
  }

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
    const parsed = copilotRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      logError("copilot_invalid_request", {
        request_id: requestId,
        issues: parsed.error.issues.length
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    const safeContext = parsed.data.context_snapshot
      ? redactContextSnapshot(parsed.data.context_snapshot).snapshot
      : undefined;
    const sessionId = parsed.data.session_id ?? safeContext?.session_id;
    const decision = decideCopilot({
      snapshot: safeContext,
      feedback: feedbackForSession(sessionId)
    });
    const validated = validateCopilotResponse(decision.response);
    if (!validated.ok) {
      logError("copilot_invalid_output", {
        request_id: requestId,
        errors: validated.errors
      });
    }

    logInfo("copilot_response", {
      request_id: requestId,
      session_id: sessionId ?? null,
      intervene: validated.data.intervene,
      score: Number(decision.decision.score.toFixed(4)),
      threshold: Number(decision.decision.threshold.toFixed(4)),
      intent: decision.decision.intent
    });
    return res.json(validated.data);
  });

  app.post("/copilot/feedback", withRequestId, requireAuth(args.env), async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const parsed = copilotFeedbackSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      logError("copilot_feedback_invalid_request", {
        request_id: requestId,
        issues: parsed.error.issues.length
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    const stats = recordFeedback({
      sessionId: parsed.data.session_id,
      action: parsed.data.action,
      timestamp: parsed.data.timestamp ?? new Date().toISOString()
    });

    logInfo("copilot_feedback_recorded", {
      request_id: requestId,
      session_id: parsed.data.session_id,
      action: parsed.data.action,
      accepts: stats.accepts,
      dismisses: stats.dismisses
    });

    return res.json({
      ok: true,
      request_id: requestId,
      session_id: parsed.data.session_id,
      stats
    });
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
