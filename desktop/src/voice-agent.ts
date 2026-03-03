/**
 * AURA Voice Agent — Main entry point.
 *
 * Single-process voice-first computer control agent.
 * Phase 1: Wake word detection (Porcupine) ✅
 * Phase 2: VAD recording + whisper transcription ✅
 * Phase 3: Gemini planning ✅
 * Phase 4: Tool execution ✅
 * Phase 5: TTS response ✅
 */

import { loadLocalDotenv } from "./localDotenv.js";
import { createWakeWordListener, resolveKeywordPath } from "./wakeWord.js";
import { recordWithVAD } from "./vad.js";
import { transcribeWithWhisperCpp } from "./whisper.js";
import { transcribeWithAppleSpeech } from "./appleSpeech.js";
import { planCommand } from "./geminiPlanner.js";
import { executeToolCall } from "./tools.js";
import { speak, type TTSConfig } from "./ttsEngine.js";
import { startTray } from "./trayMenu.js";

// Load environment variables
loadLocalDotenv();

// ── Config ──────────────────────────────────────────
const accessKey = process.env.PICOVOICE_ACCESS_KEY;
if (!accessKey) {
    console.error("❌ PICOVOICE_ACCESS_KEY is not set in .env");
    process.exit(1);
}

const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
const geminiModel = process.env.AURA_GEMINI_MODEL ?? undefined;
if (!geminiApiKey) {
    console.warn("⚠️  GEMINI_API_KEY not set — will use local fallback planner only.");
}

const whisperBin = process.env.WHISPER_CPP_BIN ?? "whisper-cli";
const whisperModel = process.env.WHISPER_MODEL_PATH ?? "models/ggml-base.en.bin";
const whisperLanguage = process.env.WHISPER_DEFAULT_LANGUAGE ?? "en";
const whisperTimeoutMs = Number(process.env.WHISPER_TIMEOUT_MS ?? "120000");
const whisperNoGpu = process.env.WHISPER_NO_GPU !== "false";

const ttsConfig: TTSConfig = {
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || undefined,
    elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || undefined,
    elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID || undefined,
};

let keywordPath: string;
try {
    keywordPath = resolveKeywordPath();
    console.log(`📂 Wake word file: ${keywordPath}`);
} catch (error) {
    console.error("❌", String(error));
    process.exit(1);
}

// ── State ───────────────────────────────────────────
let isProcessingCommand = false;
let killSwitchActive = false;

// ── System Tray ─────────────────────────────────────
const tray = startTray({
    geminiConnected: !!geminiApiKey,
    ttsEngine: ttsConfig.elevenLabsApiKey ? "ElevenLabs" : "macOS say",
    onQuit: () => {
        console.log("\n🛑 Quit from tray menu.");
        listener.stop();
        process.exit(0);
    },
});

// ── Wake word listener ──────────────────────────────
const listener = createWakeWordListener({
    accessKey,
    keywordPath,
    sensitivity: 0.7,
    deviceIndex: -1,
});

// ── Play system sound ───────────────────────────────
function playSound(soundFile: string): void {
    if (process.platform === "darwin") {
        import("node:child_process").then(({ execFile }) => {
            execFile("afplay", [soundFile], () => { });
        });
    }
}

function playListeningChime(): void {
    playSound("/System/Library/Sounds/Tink.aiff");
}

function playErrorSound(): void {
    playSound("/System/Library/Sounds/Basso.aiff");
}

// ── Speak response ──────────────────────────────────
async function speakResponse(text: string): Promise<void> {
    if (!text.trim()) return;
    try {
        console.log(`  🔊 Speaking: "${text}"`);
        const result = await speak({ text, config: ttsConfig });
        console.log(`  🔊 TTS: ${result.engine} (${(result.durationMs / 1000).toFixed(1)}s)`);
    } catch (error) {
        console.warn(`  ⚠️  TTS failed: ${String(error)}`);
    }
}

// ── Command pipeline ────────────────────────────────
async function handleWakeWord(): Promise<void> {
    if (isProcessingCommand) {
        console.log("⏳ Already processing a command, ignoring wake word.");
        return;
    }

    if (killSwitchActive) {
        console.log("🛑 Kill switch is active — ignoring wake word.");
        return;
    }

    isProcessingCommand = true;
    tray.updateState({ status: "listening" });

    console.log("");
    console.log("═══════════════════════════════════════");
    console.log("  🗣️  Hey Aura! — Listening...         ");
    console.log("═══════════════════════════════════════");

    // Stop the wake word listener to release the microphone
    listener.stop();
    playListeningChime();

    try {
        // ── Record with VAD ──
        tray.updateState({ status: "recording" });
        console.log("  🎙️  Recording... (speak your command, I'll stop when you pause)");
        const recording = await recordWithVAD({
            silenceThreshold: 0.015,
            silenceDurationMs: 1500,
            maxDurationMs: 15000,
            minDurationMs: 800,
        });

        const durationSec = (recording.durationMs / 1000).toFixed(1);
        const stoppedBy = recording.stoppedBySilence ? "silence detected" : "max duration";
        console.log(`  ✅ Recorded ${durationSec}s (${stoppedBy})`);

        // ── Transcribe ── Apple Speech (primary) + Whisper (fallback)
        tray.updateState({ status: "transcribing" });
        console.log("  🧠 Transcribing...");

        let transcript = "";
        let sttEngine = "whisper";

        // Try Apple Speech Framework first
        const appleResult = await transcribeWithAppleSpeech(recording.audioPath);
        if (appleResult && appleResult.transcript.trim()) {
            transcript = appleResult.transcript;
            sttEngine = "apple_speech";
            console.log(`  🍎 Apple Speech (${(appleResult.durationMs / 1000).toFixed(1)}s)`);
        } else {
            // Fall back to whisper.cpp
            console.log("  ⤵️  Falling back to Whisper...");
            transcript = await transcribeWithWhisperCpp({
                env: {
                    WHISPER_CPP_BIN: whisperBin,
                    WHISPER_MODEL_PATH: whisperModel,
                    WHISPER_DEFAULT_LANGUAGE: whisperLanguage,
                    WHISPER_TIMEOUT_MS: whisperTimeoutMs,
                    WHISPER_NO_GPU: whisperNoGpu,
                } as any,
                audioPath: recording.audioPath,
                language: whisperLanguage,
            });
        }

        if (!transcript.trim() || transcript.trim() === "[BLANK_AUDIO]") {
            console.log("  ⚠️  No speech detected. Please try again.");
            await speakResponse("I didn't catch that. Please try again.");
            return;
        }

        console.log(`  📝 Transcript (${sttEngine}): "${transcript}"`);
        tray.updateState({ lastTranscript: transcript });

        // Check for kill switch voice command
        const lowerTranscript = transcript.toLowerCase();
        if (lowerTranscript.includes("stop") && lowerTranscript.includes("aura") ||
            lowerTranscript.includes("kill switch") ||
            lowerTranscript.includes("abort") ||
            lowerTranscript.includes("cancel everything")) {
            killSwitchActive = true;
            console.log("  🛑 Kill switch activated by voice command!");
            await speakResponse("Kill switch activated. Say Hey Aura, resume to continue.");
            return;
        }

        if (lowerTranscript.includes("resume") || lowerTranscript.includes("continue")) {
            if (killSwitchActive) {
                killSwitchActive = false;
                console.log("  ✅ Kill switch deactivated. Resuming normal operation.");
                await speakResponse("Resuming. I'm ready for your commands.");
                return;
            }
        }

        // ── Plan with Gemini ──
        tray.updateState({ status: "planning" });
        console.log("  🤖 Planning...");
        const plan = await planCommand({
            transcript,
            geminiApiKey: geminiApiKey || undefined,
            model: geminiModel,
        });

        console.log(`  🎯 Goal: ${plan.goal}`);

        if (plan.questions.length > 0) {
            console.log("  ❓ Questions:");
            for (const q of plan.questions) {
                console.log(`     - ${q}`);
            }
            await speakResponse(plan.questions[0]);
            return;
        }

        if (plan.tool_calls.length === 0) {
            console.log("  ⚠️  No actions to take.");
            await speakResponse("I'm not sure what to do with that command.");
            return;
        }

        tray.updateState({ status: "executing", lastAction: plan.goal });
        console.log(`  🔧 Executing ${plan.tool_calls.length} tool call(s)...`);

        // ── Execute tool calls ──
        let allSucceeded = true;
        const results: string[] = [];
        for (let i = 0; i < plan.tool_calls.length; i++) {
            const call = plan.tool_calls[i];

            // Check kill switch before each tool call
            if (killSwitchActive) {
                console.log(`  🛑 Kill switch active — aborting remaining tool calls.`);
                allSucceeded = false;
                break;
            }

            const stepLabel = `[${i + 1}/${plan.tool_calls.length}]`;
            console.log(`  ${stepLabel} ${call.name}(${JSON.stringify(call.args)})`);

            const result = await executeToolCall({
                call: { name: call.name, args: call.args },
                dryRun: false,
            });

            if (result.result.success) {
                console.log(`  ${stepLabel} ✅ ${result.result.observed_state}`);
                results.push(`${call.name}: success`);
            } else {
                console.log(`  ${stepLabel} ❌ ${result.result.error ?? "unknown error"}`);
                allSucceeded = false;
                results.push(`${call.name}: failed`);
            }
        }

        // ── Speak response ──
        console.log("");
        if (allSucceeded) {
            console.log("  ✅ All actions completed successfully!");
            const response = plan.spoken_response ?? "Done.";
            tray.updateState({ status: "speaking", lastResponse: response });
            await speakResponse(response);
        } else {
            console.log("  ⚠️  Some actions failed.");
            tray.updateState({ status: "speaking", lastResponse: "Some actions failed" });
            await speakResponse("Some actions failed. Check the console for details.");
        }

    } catch (error) {
        console.error("  ❌ Error:", String(error));
        await speakResponse("Something went wrong. Please try again.");
    } finally {
        isProcessingCommand = false;
        tray.updateState({ status: "idle" });
        console.log("");

        // Restart the wake word listener
        listener.start(onWakeWordDetected);
    }
}

function onWakeWordDetected(): void {
    void handleWakeWord();
}

// ── Startup ─────────────────────────────────────────
const ttsStatus = ttsConfig.elevenLabsApiKey
    ? "✅ ElevenLabs"
    : (process.platform === "darwin" ? "📢 macOS say (fallback)" : "⚠️  none");

console.log("");
console.log("╔═══════════════════════════════════════╗");
console.log("║    🌟 AURA Voice Agent                ║");
console.log("║    Voice-First Computer Control        ║");
console.log("╠═══════════════════════════════════════╣");
console.log("║  Say \"Hey Aura\" then speak a command  ║");
console.log("║  Press Ctrl+C to exit                  ║");
console.log("╚═══════════════════════════════════════╝");
console.log(`  Gemini: ${geminiApiKey ? "✅ configured" : "⚠️  local fallback"}`);
console.log(`  TTS: ${ttsStatus}`);
console.log("");

listener.start(onWakeWordDetected);

// ── Graceful shutdown ───────────────────────────────
function shutdown(): void {
    console.log("\n🛑 Shutting down AURA Voice Agent...");
    listener.stop();
    tray.stop();
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
