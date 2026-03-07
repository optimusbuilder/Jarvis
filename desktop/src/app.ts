import express from "express";
import type { Env } from "./env.js";
import { backendPlan, backendTts } from "./backendClient.js";
import {
  actionPlanSchema,
  executeRequestSchema,
  killSwitchRequestSchema,
  runRequestSchema,
  voicePttStartRequestSchema,
  voiceRespondRequestSchema,
  voicePttStopRequestSchema,
  voiceRunRequestSchema,
  voiceTranscribeRequestSchema,
  toolResultSchema,
  type ActionPlan
} from "./schemas.js";
import { allowedToolNames, executeToolCall, toolSchemas } from "./tools.js";
import { getFrontmostAppName, getPermissionStatus } from "./macos.js";
import { appendAuditLog, ensureRequestId } from "./logging.js";
import { transcribeWithWhisperCpp } from "./whisper.js";
import { startPushToTalkCapture, type PushToTalkCapture } from "./ptt.js";
import { transcribeAudio, type WhisperTranscriber } from "./voice.js";
import { playAudioFile, writeAudioFile } from "./audio.js";
import { renderControlCenterHtml } from "./ui.js";

type AuraRequest = express.Request & { aura_request_id?: string };
type BackendPlanFn = typeof backendPlan;
type BackendTtsFn = typeof backendTts;

// ── Simple in-memory rate limiter ────────────────────────────────────────────
// Keyed by IP + route prefix. Counts requests within a sliding 60-second window.
const rateLimitCounts = new Map<string, number[]>();

function rateLimit(maxPerMinute: number): express.RequestHandler {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path.split("/")[1] ?? "root"}`;
    const now = Date.now();
    const windowMs = 60_000;
    const timestamps = (rateLimitCounts.get(key) ?? []).filter(t => now - t < windowMs);
    if (timestamps.length >= maxPerMinute) {
      res.status(429).json({ error: "rate_limit_exceeded", retry_after_ms: windowMs });
      return;
    }
    timestamps.push(now);
    rateLimitCounts.set(key, timestamps);
    next();
  };
}
// ─────────────────────────────────────────────────────────────────────────────

type AgentDependencies = {
  backendPlan?: BackendPlanFn;
  backendTts?: BackendTtsFn;
  whisperTranscribe?: WhisperTranscriber;
  startPushToTalkCapture?: typeof startPushToTalkCapture;
  writeAudioFile?: typeof writeAudioFile;
  playAudioFile?: typeof playAudioFile;
};

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

function normalizeInstruction(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLowerCase();
}

function looksLikeUrl(text: string): boolean {
  if (text.startsWith("http://") || text.startsWith("https://")) return true;
  if (text.includes(" ") || text.length < 4) return false;
  return /^[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(text);
}

function toUrl(text: string): string {
  if (text.startsWith("http://") || text.startsWith("https://")) return text;
  return `https://${text}`;
}

function toGoogleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
}

function buildLocalFallbackPlan(instruction: string): ActionPlan | null {
  const text = normalizeInstruction(instruction);

  const openChromeSearchMatch = text.match(
    /^(open|launch|start)\s+(google chrome|chrome)\s+(and|&)\s+(search|google)\s+(for\s+)?(.+)$/
  );
  if (openChromeSearchMatch) {
    const query = openChromeSearchMatch[6]?.trim();
    if (!query) return null;
    return {
      goal: `Open Google Chrome and search for ${query}`,
      questions: [],
      tool_calls: [
        { name: "open_app", args: { name: "Google Chrome" } },
        { name: "open_url", args: { url: toGoogleSearchUrl(query) } }
      ]
    };
  }

  const searchMatch = text.match(/^(search|google)(\s+for)?\s+(.+)$/);
  if (searchMatch) {
    const query = searchMatch[3]?.trim();
    if (!query) return null;
    return {
      goal: `Search for ${query}`,
      questions: [],
      tool_calls: [{ name: "open_url", args: { url: toGoogleSearchUrl(query) } }]
    };
  }

  const openMatch = text.match(/^(open|launch|start)\s+(.+)$/);
  if (openMatch) {
    const target = openMatch[2]?.trim() ?? "";
    const appAliases: Record<string, string> = {
      chrome: "Google Chrome",
      "google chrome": "Google Chrome",
      safari: "Safari",
      finder: "Finder",
      terminal: "Terminal",
      notes: "Notes",
      textedit: "TextEdit"
    };
    const pathAliases: Record<string, string> = {
      documents: "~/Documents",
      downloads: "~/Downloads",
      desktop: "~/Desktop"
    };
    if (appAliases[target]) {
      return {
        goal: `Open ${appAliases[target]}`,
        questions: [],
        tool_calls: [{ name: "open_app", args: { name: appAliases[target] } }]
      };
    }
    if (pathAliases[target]) {
      return {
        goal: `Open ${target}`,
        questions: [],
        tool_calls: [{ name: "open_path", args: { path: pathAliases[target] } }]
      };
    }
    if (looksLikeUrl(target)) {
      return {
        goal: `Open ${target}`,
        questions: [],
        tool_calls: [{ name: "open_url", args: { url: toUrl(target) } }]
      };
    }
  }

  const goMatch = text.match(/^(go to|navigate to)\s+(.+)$/);
  if (goMatch) {
    const target = goMatch[2]?.trim() ?? "";
    if (!target) return null;
    if (looksLikeUrl(target)) {
      return {
        goal: `Go to ${target}`,
        questions: [],
        tool_calls: [{ name: "open_url", args: { url: toUrl(target) } }]
      };
    }
  }

  return null;
}

async function executePlan(args: {
  plan: { goal: string; tool_calls: Array<{ name: string; args: Record<string, unknown> }> };
  dryRun: boolean;
  shouldAbort?: () => { aborted: boolean; reason: string | null };
}) {
  const results: Array<{
    requested_tool: string;
    normalized_tool: string;
    result: unknown;
  }> = [];
  let aborted = false;
  let abortReason: string | null = null;

  for (const call of args.plan.tool_calls) {
    const gate = args.shouldAbort?.();
    if (gate?.aborted) {
      aborted = true;
      abortReason = gate.reason ?? "kill_switch_active";
      results.push({
        requested_tool: call.name,
        normalized_tool: call.name,
        result: toolResultSchema.parse({
          success: false,
          observed_state: `blocked: kill_switch_active reason='${abortReason}'`,
          error: "kill_switch_active"
        })
      });
      break;
    }
    const out = await executeToolCall({ call, dryRun: args.dryRun });
    results.push({
      requested_tool: out.requested_tool,
      normalized_tool: out.normalized_tool,
      result: toolResultSchema.parse(out.result)
    });
  }

  return {
    results,
    aborted,
    abort_reason: abortReason
  };
}

function executionAllToolCallsBlockedByAllowlist(args: {
  plan: { tool_calls: Array<{ name: string; args: Record<string, unknown> }> };
  execution: { results: Array<{ result: unknown }>; aborted: boolean };
}): boolean {
  if (args.execution.aborted) return false;
  if (!args.plan.tool_calls.length) return false;
  if (args.execution.results.length !== args.plan.tool_calls.length) return false;
  return args.execution.results.every((item) => {
    if (!item.result || typeof item.result !== "object") return false;
    const error = (item.result as { error?: unknown }).error;
    return error === "tool_not_allowed";
  });
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

async function requestPlan(args: {
  env: Env;
  planner: BackendPlanFn;
  requestId: string;
  instruction: string;
  contextSnapshot?: unknown;
}): Promise<{ plan: ActionPlan; backendRequestId: string | null }> {
  const front = await getFrontmostAppName();
  const planned = await args.planner({
    env: args.env,
    instruction: args.instruction,
    desktopState: {
      os: "macos",
      frontmost_app: front ?? "unknown"
    },
    contextSnapshot: args.contextSnapshot,
    requestId: args.requestId
  });
  const validated = actionPlanSchema.safeParse(planned.payload);
  if (!validated.success) {
    return {
      backendRequestId: planned.requestId,
      plan: failClosedPlan("Planner output failed schema validation; no actions were executed.")
    };
  }
  return {
    backendRequestId: planned.requestId,
    plan: validated.data
  };
}

function classifyVoiceError(error: unknown): { status: number; message: string } {
  const message = String(error ?? "voice_error");
  if (message.includes("audio_not_found:")) {
    return { status: 400, message: "audio_not_found" };
  }
  if (message.includes("ptt_not_supported")) {
    return { status: 400, message: "ptt_not_supported" };
  }
  if (message.includes("capture_failed")) {
    return { status: 422, message };
  }
  if (message.includes("audio_player_not_configured")) {
    return { status: 500, message: "audio_player_not_configured" };
  }
  if (message.includes("backend /tts failed")) {
    return { status: 502, message: "tts_failed" };
  }
  return { status: 500, message };
}

export function createAgentApp(args: { env: Env; deps?: AgentDependencies }): express.Express {
  const app = express();
  const planner = args.deps?.backendPlan ?? backendPlan;
  const ttsClient = args.deps?.backendTts ?? backendTts;
  const whisperTranscriber = args.deps?.whisperTranscribe ?? transcribeWithWhisperCpp;
  const pttStarter = args.deps?.startPushToTalkCapture ?? startPushToTalkCapture;
  const audioWriter = args.deps?.writeAudioFile ?? writeAudioFile;
  const audioPlayer = args.deps?.playAudioFile ?? playAudioFile;

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, x-request-id");
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(withRequestId);

  let activeCapture: PushToTalkCapture | null = null;
  let killSwitchActive = false;
  let killSwitchReason: string | null = null;
  let killSwitchActivatedAt: string | null = null;

  function readKillSwitch(): { aborted: boolean; reason: string | null } {
    return {
      aborted: killSwitchActive,
      reason: killSwitchReason
    };
  }

  function setKillSwitch(args: { active: boolean; reason?: string }): void {
    if (args.active) {
      killSwitchActive = true;
      killSwitchReason = args.reason?.trim() || "manual_kill_switch";
      killSwitchActivatedAt = new Date().toISOString();
      return;
    }
    killSwitchActive = false;
    killSwitchReason = null;
    killSwitchActivatedAt = null;
  }

  app.get("/", (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    res.setHeader("x-request-id", requestId);
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.status(200).send(renderControlCenterHtml());
  });

  app.get("/ui", (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    res.setHeader("x-request-id", requestId);
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.status(200).send(renderControlCenterHtml());
  });

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



  app.get("/control", async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    await writeAudit({
      env: args.env,
      requestId,
      event: "control_status",
      data: {
        kill_switch_active: killSwitchActive
      }
    });
    return res.json({
      ok: true,
      request_id: requestId,
      kill_switch_active: killSwitchActive,
      kill_switch_reason: killSwitchReason,
      kill_switch_activated_at: killSwitchActivatedAt
    });
  });

  app.post("/control/kill-switch", async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const parsed = killSwitchRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      await writeAudit({
        env: args.env,
        requestId,
        event: "control_kill_switch_invalid_request",
        data: { issues: parsed.error.issues.length }
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    setKillSwitch({
      active: parsed.data.active,
      reason: parsed.data.reason
    });

    await writeAudit({
      env: args.env,
      requestId,
      event: "control_kill_switch_updated",
      data: {
        active: killSwitchActive,
        reason: killSwitchReason
      }
    });

    return res.json({
      ok: true,
      request_id: requestId,
      kill_switch_active: killSwitchActive,
      kill_switch_reason: killSwitchReason,
      kill_switch_activated_at: killSwitchActivatedAt
    });
  });

  app.post("/voice/ptt/start", rateLimit(20), async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const parsed = voicePttStartRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_ptt_start_invalid_request",
        data: { issues: parsed.error.issues.length }
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    if (activeCapture) {
      return res.status(409).json({
        error: "capture_already_active",
        capture_id: activeCapture.capture_id
      });
    }

    try {
      activeCapture = await pttStarter({
        outputPath: parsed.data.output_path,
        inputDevice: parsed.data.input_device
      });
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_ptt_started",
        data: {
          capture_id: activeCapture.capture_id,
          audio_path: activeCapture.audio_path
        }
      });
      return res.json({
        ok: true,
        request_id: requestId,
        capture_id: activeCapture.capture_id,
        audio_path: activeCapture.audio_path,
        started_at: activeCapture.started_at
      });
    } catch (error) {
      const classified = classifyVoiceError(error);
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_ptt_start_failed",
        data: { error: classified.message }
      });
      return res.status(classified.status).json({ error: classified.message });
    }
  });

  app.post("/voice/ptt/stop", rateLimit(20), async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const parsed = voicePttStopRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_ptt_stop_invalid_request",
        data: { issues: parsed.error.issues.length }
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    if (!activeCapture) {
      return res.status(409).json({ error: "capture_not_active" });
    }
    if (parsed.data.capture_id && parsed.data.capture_id !== activeCapture.capture_id) {
      return res.status(409).json({ error: "capture_id_mismatch" });
    }

    const capture = activeCapture;
    activeCapture = null;

    try {
      const result = await capture.stop();
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_ptt_stopped",
        data: {
          capture_id: capture.capture_id,
          audio_path: result.audio_path,
          duration_ms: result.duration_ms,
          bytes: result.bytes
        }
      });
      return res.json({
        ok: true,
        request_id: requestId,
        capture_id: capture.capture_id,
        ...result
      });
    } catch (error) {
      const classified = classifyVoiceError(error);
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_ptt_stop_failed",
        data: { capture_id: capture.capture_id, error: classified.message }
      });
      return res.status(classified.status).json({ error: classified.message });
    }
  });

  app.post("/voice/transcribe", rateLimit(20), async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const parsed = voiceTranscribeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_transcribe_invalid_request",
        data: { issues: parsed.error.issues.length }
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    try {
      const assessment = await transcribeAudio({
        env: args.env,
        audioPath: parsed.data.audio_path,
        language: parsed.data.language,
        minWords: args.env.AURA_STT_MIN_WORDS,
        minChars: args.env.AURA_STT_MIN_CHARS,
        transcriber: whisperTranscriber
      });

      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_transcribe_completed",
        data: {
          quality: assessment.quality,
          word_count: assessment.word_count,
          char_count: assessment.char_count,
          audio_path: parsed.data.audio_path
        }
      });

      return res.json({
        ok: true,
        request_id: requestId,
        audio_path: parsed.data.audio_path,
        transcript: assessment.transcript,
        quality: assessment.quality,
        reason: assessment.reason,
        word_count: assessment.word_count,
        char_count: assessment.char_count
      });
    } catch (error) {
      const classified = classifyVoiceError(error);
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_transcribe_failed",
        data: { error: classified.message, audio_path: parsed.data.audio_path }
      });
      return res.status(classified.status).json({ error: classified.message });
    }
  });

  app.post("/voice/run", rateLimit(20), async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const parsed = voiceRunRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_run_invalid_request",
        data: { issues: parsed.error.issues.length }
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    let assessment;
    try {
      assessment = await transcribeAudio({
        env: args.env,
        audioPath: parsed.data.audio_path,
        language: parsed.data.language,
        minWords: args.env.AURA_STT_MIN_WORDS,
        minChars: args.env.AURA_STT_MIN_CHARS,
        transcriber: whisperTranscriber
      });
    } catch (error) {
      const classified = classifyVoiceError(error);
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_run_transcribe_failed",
        data: { error: classified.message, audio_path: parsed.data.audio_path }
      });
      return res.status(classified.status).json({ error: classified.message });
    }

    if (assessment.quality !== "good") {
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_run_repeat_requested",
        data: {
          quality: assessment.quality,
          reason: assessment.reason,
          word_count: assessment.word_count,
          char_count: assessment.char_count
        }
      });
      return res.json({
        ok: true,
        request_id: requestId,
        needs_repeat: true,
        transcript: assessment.transcript,
        quality: assessment.quality,
        reason: assessment.reason,
        plan: null,
        results: []
      });
    }

    let backendRequestId: string | null = null;
    let plan: ActionPlan = failClosedPlan("Planner output was invalid; no actions were executed.");
    try {
      const planned = await requestPlan({
        env: args.env,
        planner,
        requestId,
        instruction: assessment.transcript,
        contextSnapshot: parsed.data.context_snapshot
      });
      backendRequestId = planned.backendRequestId;
      plan = planned.plan;
    } catch (error) {
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_run_planner_failed",
        data: { error: String(error) }
      });
      return res.status(502).json({ error: "planner_failed", message: String(error) });
    }

    let execution = await executePlan({
      plan,
      dryRun: parsed.data.dry_run,
      shouldAbort: readKillSwitch
    });
    let fallbackUsed = false;

    if (executionAllToolCallsBlockedByAllowlist({ plan, execution })) {
      const fallbackPlan = buildLocalFallbackPlan(assessment.transcript);
      if (fallbackPlan) {
        fallbackUsed = true;
        plan = fallbackPlan;
        execution = await executePlan({
          plan: fallbackPlan,
          dryRun: parsed.data.dry_run,
          shouldAbort: readKillSwitch
        });
        await writeAudit({
          env: args.env,
          requestId,
          event: "voice_run_fallback_applied",
          data: {
            reason: "planner_tools_blocked",
            instruction_chars: assessment.transcript.length,
            fallback_goal: fallbackPlan.goal,
            fallback_tools: fallbackPlan.tool_calls.map((call) => call.name)
          }
        });
      }
    } else if (!plan.tool_calls.length) {
      const fallbackPlan = buildLocalFallbackPlan(assessment.transcript);
      if (fallbackPlan) {
        fallbackUsed = true;
        plan = fallbackPlan;
        execution = await executePlan({
          plan: fallbackPlan,
          dryRun: parsed.data.dry_run,
          shouldAbort: readKillSwitch
        });
        await writeAudit({
          env: args.env,
          requestId,
          event: "voice_run_fallback_applied",
          data: {
            reason: "planner_empty_tool_calls",
            instruction_chars: assessment.transcript.length,
            fallback_goal: fallbackPlan.goal,
            fallback_tools: fallbackPlan.tool_calls.map((call) => call.name)
          }
        });
      }
    }

    await writeAudit({
      env: args.env,
      requestId,
      event: "voice_run_completed",
      data: {
        backend_request_id: backendRequestId,
        dry_run: parsed.data.dry_run,
        quality: assessment.quality,
        word_count: assessment.word_count,
        goal: plan.goal,
        tool_calls: plan.tool_calls.map((call) => call.name),
        result_count: execution.results.length,
        aborted: execution.aborted,
        fallback_used: fallbackUsed
      }
    });

    return res.json({
      ok: true,
      request_id: requestId,
      backend_request_id: backendRequestId,
      needs_repeat: false,
      transcript: assessment.transcript,
      quality: assessment.quality,
      reason: assessment.reason,
      plan,
      results: execution.results,
      aborted: execution.aborted,
      abort_reason: execution.abort_reason,
      planner_fallback_used: fallbackUsed
    });
  });

  app.post("/voice/respond", rateLimit(20), async (req, res) => {
    const requestId = (req as AuraRequest).aura_request_id ?? ensureRequestId(req, res);
    const parsed = voiceRespondRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_respond_invalid_request",
        data: { issues: parsed.error.issues.length }
      });
      return res.status(400).json({ error: "invalid_request" });
    }

    try {
      const tts = await ttsClient({
        env: args.env,
        text: parsed.data.text,
        voiceId: parsed.data.voice_id
      });
      const written = await audioWriter({
        audio: tts.audio,
        contentType: tts.contentType,
        outputPath: parsed.data.output_path
      });

      let played = false;
      if (parsed.data.speak) {
        await audioPlayer({
          audioPath: written.audioPath,
          playerCommand: args.env.AURA_AUDIO_PLAYER_CMD
        });
        played = true;
      }

      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_respond_completed",
        data: {
          text_chars: parsed.data.text.length,
          audio_path: written.audioPath,
          audio_bytes: written.bytes,
          content_type: tts.contentType,
          played
        }
      });

      return res.json({
        ok: true,
        request_id: requestId,
        audio_path: written.audioPath,
        audio_bytes: written.bytes,
        content_type: tts.contentType,
        played
      });
    } catch (error) {
      const classified = classifyVoiceError(error);
      await writeAudit({
        env: args.env,
        requestId,
        event: "voice_respond_failed",
        data: { error: classified.message }
      });
      return res.status(classified.status).json({ error: classified.message });
    }
  });

  app.post("/execute", rateLimit(30), async (req, res) => {
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

    const execution = await executePlan({
      plan: parsed.data.plan,
      dryRun: parsed.data.dry_run,
      shouldAbort: readKillSwitch
    });
    const blockedCount = execution.results.filter((item) => {
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
        result_count: execution.results.length,
        aborted: execution.aborted
      }
    });

    return res.json({
      ok: true,
      request_id: requestId,
      goal: parsed.data.plan.goal,
      results: execution.results,
      aborted: execution.aborted,
      abort_reason: execution.abort_reason
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

    let backendRequestId: string | null = null;
    let plan: ActionPlan = failClosedPlan("Planner output was invalid; no actions were executed.");

    try {
      const planned = await requestPlan({
        env: args.env,
        planner,
        requestId,
        instruction: parsed.data.instruction,
        contextSnapshot: parsed.data.context_snapshot
      });
      backendRequestId = planned.backendRequestId;
      plan = planned.plan;
    } catch (err) {
      await writeAudit({
        env: args.env,
        requestId,
        event: "run_planner_failed",
        data: { error: String(err) }
      });
      return res.status(502).json({ error: "planner_failed", message: String(err) });
    }

    let execution = await executePlan({
      plan,
      dryRun: parsed.data.dry_run,
      shouldAbort: readKillSwitch
    });
    let fallbackUsed = false;

    if (executionAllToolCallsBlockedByAllowlist({ plan, execution })) {
      const fallbackPlan = buildLocalFallbackPlan(parsed.data.instruction);
      if (fallbackPlan) {
        fallbackUsed = true;
        plan = fallbackPlan;
        execution = await executePlan({
          plan: fallbackPlan,
          dryRun: parsed.data.dry_run,
          shouldAbort: readKillSwitch
        });
        await writeAudit({
          env: args.env,
          requestId,
          event: "run_fallback_applied",
          data: {
            reason: "planner_tools_blocked",
            instruction_chars: parsed.data.instruction.length,
            fallback_goal: fallbackPlan.goal,
            fallback_tools: fallbackPlan.tool_calls.map((call) => call.name)
          }
        });
      }
    } else if (!plan.tool_calls.length) {
      const fallbackPlan = buildLocalFallbackPlan(parsed.data.instruction);
      if (fallbackPlan) {
        fallbackUsed = true;
        plan = fallbackPlan;
        execution = await executePlan({
          plan: fallbackPlan,
          dryRun: parsed.data.dry_run,
          shouldAbort: readKillSwitch
        });
        await writeAudit({
          env: args.env,
          requestId,
          event: "run_fallback_applied",
          data: {
            reason: "planner_empty_tool_calls",
            instruction_chars: parsed.data.instruction.length,
            fallback_goal: fallbackPlan.goal,
            fallback_tools: fallbackPlan.tool_calls.map((call) => call.name)
          }
        });
      }
    }

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
        result_count: execution.results.length,
        aborted: execution.aborted,
        fallback_used: fallbackUsed
      }
    });

    return res.json({
      ok: true,
      request_id: requestId,
      backend_request_id: backendRequestId,
      plan,
      results: execution.results,
      aborted: execution.aborted,
      abort_reason: execution.abort_reason,
      planner_fallback_used: fallbackUsed
    });
  });

  return app;
}
