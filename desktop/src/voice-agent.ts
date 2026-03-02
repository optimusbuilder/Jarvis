/**
 * AURA Voice Agent — Main entry point.
 *
 * Single-process voice-first computer control agent.
 * Phase 1: Wake word detection (Porcupine) ✅
 * Phase 2: VAD recording + whisper transcription ✅
 * Phase 3: Gemini planning (TODO)
 * Phase 4: Tool execution (TODO)
 * Phase 5: TTS response (TODO)
 */

import { loadLocalDotenv } from "./localDotenv.js";
import { createWakeWordListener, resolveKeywordPath } from "./wakeWord.js";
import { recordWithVAD } from "./vad.js";
import { transcribeWithWhisperCpp } from "./whisper.js";

// Load environment variables
loadLocalDotenv();

// ── Config ──────────────────────────────────────────
const accessKey = process.env.PICOVOICE_ACCESS_KEY;
if (!accessKey) {
    console.error("❌ PICOVOICE_ACCESS_KEY is not set in .env");
    process.exit(1);
}

const whisperBin = process.env.WHISPER_CPP_BIN ?? "whisper-cli";
const whisperModel = process.env.WHISPER_MODEL_PATH ?? "models/ggml-base.en.bin";
const whisperLanguage = process.env.WHISPER_DEFAULT_LANGUAGE ?? "en";
const whisperTimeoutMs = Number(process.env.WHISPER_TIMEOUT_MS ?? "120000");
const whisperNoGpu = process.env.WHISPER_NO_GPU !== "false";

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

function playDoneChime(): void {
    playSound("/System/Library/Sounds/Glass.aiff");
}

function playErrorSound(): void {
    playSound("/System/Library/Sounds/Basso.aiff");
}

// ── Command pipeline ────────────────────────────────
async function handleWakeWord(): Promise<void> {
    if (isProcessingCommand) {
        console.log("⏳ Already processing a command, ignoring wake word.");
        return;
    }

    isProcessingCommand = true;

    console.log("");
    console.log("═══════════════════════════════════════");
    console.log("  🗣️  Hey Aura! — Listening...         ");
    console.log("═══════════════════════════════════════");

    // Stop the wake word listener to release the microphone
    listener.stop();
    playListeningChime();

    try {
        // ── Phase 2: Record with VAD ──
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
        console.log(`  📁 Audio: ${recording.audioPath}`);

        // ── Phase 2: Transcribe with whisper ──
        console.log("  🧠 Transcribing...");
        const transcript = await transcribeWithWhisperCpp({
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

        if (!transcript.trim()) {
            console.log("  ⚠️  No speech detected. Please try again.");
            playErrorSound();
        } else {
            console.log("");
            console.log(`  📝 Transcript: "${transcript}"`);
            console.log("");
            console.log("  (Phase 3 will plan this command)");
            console.log("  (Phase 4 will execute the plan)");
            console.log("  (Phase 5 will speak the result)");
            playDoneChime();
        }

    } catch (error) {
        console.error("  ❌ Error:", String(error));
        playErrorSound();
    } finally {
        isProcessingCommand = false;
        console.log("");

        // Restart the wake word listener
        listener.start(onWakeWordDetected);
    }
}

function onWakeWordDetected(): void {
    void handleWakeWord();
}

// ── Startup ─────────────────────────────────────────
console.log("");
console.log("╔═══════════════════════════════════════╗");
console.log("║    🌟 AURA Voice Agent — Phase 2      ║");
console.log("║    Wake Word + Voice Recording + STT   ║");
console.log("╠═══════════════════════════════════════╣");
console.log("║  Say \"Hey Aura\" then speak a command  ║");
console.log("║  Recording stops when you pause        ║");
console.log("║  Press Ctrl+C to exit                  ║");
console.log("╚═══════════════════════════════════════╝");
console.log("");

listener.start(onWakeWordDetected);

// ── Graceful shutdown ───────────────────────────────
function shutdown(): void {
    console.log("\n🛑 Shutting down AURA Voice Agent...");
    listener.stop();
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
