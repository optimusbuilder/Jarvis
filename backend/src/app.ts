import express from "express";
import type { Env } from "./env.js";
import { requireAuth } from "./auth.js";
import { copilotResponseSchema, planRequestSchema, ttsRequestSchema } from "./schemas.js";
import type { VertexPlanner } from "./vertex.js";
import { elevenLabsTts } from "./elevenlabs.js";
import { generateSilentWav } from "./stubAudio.js";
import { redactContextSnapshot } from "./redaction.js";
import { validateActionPlan } from "./contracts.js";

export function createApp(args: {
  env: Env;
  planner: VertexPlanner;
}): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "aura-backend", ts: new Date().toISOString() });
  });

  app.post("/plan", requireAuth(args.env), async (req, res) => {
    const parsed = planRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request" });
    }

    try {
      const safeContext = parsed.data.context_snapshot
        ? redactContextSnapshot(parsed.data.context_snapshot).snapshot
        : undefined;
      const rawPlan = await args.planner.plan({
        instruction: parsed.data.instruction,
        context: safeContext,
        state: parsed.data.desktop_state
      });
      const validated = validateActionPlan(rawPlan);
      return res.json(validated.data);
    } catch (err) {
      return res.status(502).json({ error: "planner_failed", message: String(err) });
    }
  });

  app.post("/copilot", requireAuth(args.env), async (req, res) => {
    // Skeleton: deterministic fail-closed default until we implement scoring + prompting.
    const safe = copilotResponseSchema.parse({
      intervene: false,
      reason: "Copilot not enabled yet.",
      response: "",
      ui_action: null
    });
    return res.json(safe);
  });

  app.post("/tts", requireAuth(args.env), async (req, res) => {
    const parsed = ttsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request" });
    }

    if (args.env.AURA_TTS_MODE !== "elevenlabs") {
      const wav = generateSilentWav({ seconds: 0.35 });
      res.setHeader("content-type", "audio/wav");
      return res.status(200).send(wav);
    }

    const voiceId = parsed.data.voice_id ?? args.env.ELEVENLABS_VOICE_ID;
    if (!voiceId) return res.status(500).json({ error: "tts_not_configured" });

    try {
      const out = await elevenLabsTts({ env: args.env, voiceId, text: parsed.data.text });
      res.setHeader("content-type", out.contentType);
      return res.status(200).send(out.audio);
    } catch (err) {
      return res.status(502).json({ error: "tts_failed", message: String(err) });
    }
  });

  return app;
}
