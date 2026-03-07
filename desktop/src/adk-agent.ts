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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createWakeWordListener, resolveKeywordPath } from "./wakeWord.js";
import { recordWithVAD } from "./vad.js";
import { transcribeWithWhisperCpp } from "./whisper.js";
import { transcribeWithAppleSpeech } from "./appleSpeech.js";
import { LlmAgent, Gemini, Runner, InMemorySessionService } from '@google/adk';
import { toAdkTools } from "./tools.js";
import { speak, type TTSConfig } from "./ttsEngine.js";
import { startTray } from "./trayMenu.js";
import { showOverlay, dismissOverlay, showContextPanel, dismissContextPanel } from "./overlay.js";
import { getHighlightedText } from "./clipboardHack.js";

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
async function playSound(soundFile: string): Promise<void> {
    if (process.platform !== "darwin") return;
    return new Promise((resolve) => {
        const child = spawn("afplay", [soundFile], { stdio: "ignore" });
        child.on("error", (err: Error) => {
            console.warn(`  ⚠️  Sound failed: ${soundFile} — ${err.message}`);
            resolve();
        });
        child.on("exit", () => resolve());
    });
}

async function playListeningChime(): Promise<void> {
    // Custom two-tone rising chime
    const chimePath = resolve(process.cwd(), "desktop", "assets", "wake-chime.wav");
    await playSound(chimePath);
}

async function playFollowUpChime(): Promise<void> {
    // Softer, shorter chime for follow-up listening
    const chimePath = resolve(process.cwd(), "desktop", "assets", "followup-chime.wav");
    await playSound(chimePath);
}

async function playErrorSound(): Promise<void> {
    await playSound("/System/Library/Sounds/Basso.aiff");
}

// ── Speak response ──────────────────────────────────
async function speakResponse(text: string): Promise<void> {
    if (!text.trim()) return;
    try {
        console.log(`  🔊 Speaking: "${text}"`);
        showOverlay({ text, dismissAfterSec: 30 });
        const result = await speak({ text, config: ttsConfig });
        console.log(`  🔊 TTS: ${result.engine} (${(result.durationMs / 1000).toFixed(1)}s)`);
        dismissOverlay();
    } catch (error) {
        console.warn(`  ⚠️  TTS failed: ${String(error)}`);
        dismissOverlay();
    }
}

const adkSessionService = new InMemorySessionService();
let adkRunner: Runner | null = null;
let currentSessionId: string | null = null;

async function getAdkRunner(): Promise<{ runner: Runner, sessionId: string }> {
    if (!adkRunner) {
        const ai = new Gemini({ model: geminiModel || "gemini-2.5-flash", apiKey: geminiApiKey });
        const instruction = `You are Jarvis, a voice-controlled AI assistant for macOS built by Oluwaferanmi. You control the user's computer using tools.

RULES:
1. You are speaking to the user in real-time via voice. Keep your responses SHORT and conversational.
2. When the user asks you to do something on their computer, call the appropriate tool.
3. After a tool succeeds, confirm briefly: "Done", "Opening Safari", etc.
4. For questions about real-time info, use web_search.
5. If asked to "explain this" and there is highlighted text, use show_context_panel.`;

        const agent = new LlmAgent({
            name: "Jarvis",
            model: ai,
            tools: toAdkTools(),
            instruction,
        });

        adkRunner = new Runner({
            agent,
            appName: "Aura",
            sessionService: adkSessionService
        });
    }

    if (!currentSessionId) {
        const session = await adkSessionService.createSession({
            appName: "Aura",
            userId: "default_user"
        });
        currentSessionId = session.id;
    }

    return { runner: adkRunner, sessionId: currentSessionId };
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
    console.log("  🗣️  Jarvis! — Listening...             ");
    console.log("═══════════════════════════════════════");

    // Stop the wake word listener to release the microphone
    listener.stop();

    // Show visual overlay indicator immediately
    showOverlay({ text: "Listening...", title: "Jarvis" });

    // Small delay to let audio device fully release, then play chime
    await new Promise(r => setTimeout(r, 100));
    await playListeningChime();

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
            await speakResponse("Kill switch activated. Say Jarvis, resume to continue.");
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

        // ── Extract Highlighted Text ──
        console.log("  📋 Checking for highlighted text context...");
        const selectedText = await getHighlightedText();
        if (selectedText) {
            console.log(`     [Detected ${selectedText.length} chars selected]`);
        }

        // ── Execute with ADK ──
        tray.updateState({ status: "planning" });
        showOverlay({ text: "Thinking...", title: "Jarvis" });
        console.log("  🤖 Thinking (ADK Runner)...");

        const { runner, sessionId } = await getAdkRunner();
        let promptText = transcript;
        if (selectedText) {
            promptText += `\n\n[Currently Highlighted Text]\n${selectedText}`;
        }

        const request = {
            userId: "default_user",
            sessionId,
            newMessage: { role: "user", parts: [{ text: promptText }] }
        };

        let responseText = "";

        try {
            // runAsync maintains session history across calls using sessionId
            for await (const event of runner.runAsync(request)) {
                if (event.content && event.content.parts && event.content.parts.length > 0) {
                    const txt = event.content.parts[0].text;
                    if (txt) {
                        responseText += txt;
                    }
                }
            }
        } catch (adkErr) {
            console.error("  ❌ ADK Error:", String(adkErr));
            responseText = "I encountered an internal error while processing that.";
        }

        // ── Speak response ──
        console.log("");
        if (responseText) {
            console.log(`  ✅ ADK Response: ${responseText}`);
            tray.updateState({ status: "speaking", lastResponse: responseText });
            await speakResponse(responseText);
        } else {
            console.log("  ⚠️  No text response generated by ADK.");
            tray.updateState({ status: "speaking", lastResponse: "Done." });
            await speakResponse("Done.");
        }

    } catch (error) {
        console.error("  ❌ Error:", String(error));
        await speakResponse("Something went wrong. Please try again.");
    } finally {
        isProcessingCommand = false;
        tray.updateState({ status: "idle" });
        console.log("");

        // ── Follow-up window: stay awake for 20s ──
        await startFollowUpWindow();
    }
}

const FOLLOW_UP_TIMEOUT_MS = 20_000;

/** After a command, stay awake and listen for follow-up commands for 20s. */
async function startFollowUpWindow(): Promise<void> {
    console.log(`  ⏱️  Listening for follow-up (${FOLLOW_UP_TIMEOUT_MS / 1000}s)...`);
    tray.updateState({ status: "listening" });

    // Play a subtle tone to indicate we're still listening
    await playFollowUpChime();

    try {
        const recording = await recordWithVAD({
            silenceThreshold: 0.015,
            silenceDurationMs: 1500,
            maxDurationMs: 15000,
            minDurationMs: 800,
            // Wait up to FOLLOW_UP_TIMEOUT_MS for speech to start
            initialSilenceTimeoutMs: FOLLOW_UP_TIMEOUT_MS,
        });

        // If no speech was detected during the window, go back to wake word
        if (!recording || recording.durationMs < 500) {
            console.log("  ⏱️  No follow-up detected. Returning to wake word mode.");
            console.log("");
            console.log("🎙️  Listening for \"Jarvis\"...");
            listener.start(onWakeWordDetected);
            return;
        }

        const durationSec = (recording.durationMs / 1000).toFixed(1);
        console.log(`  ✅ Follow-up recorded: ${durationSec}s`);

        // Process this follow-up command through the full pipeline
        isProcessingCommand = true;
        showOverlay({ text: "Listening...", title: "Jarvis" });

        // Transcribe
        tray.updateState({ status: "transcribing" });
        console.log("  🧠 Transcribing...");

        let transcript = "";
        let sttEngine = "whisper";

        const appleResult = await transcribeWithAppleSpeech(recording.audioPath);
        if (appleResult && appleResult.transcript.trim()) {
            transcript = appleResult.transcript;
            sttEngine = "apple_speech";
            console.log(`  🍎 Apple Speech (${(appleResult.durationMs / 1000).toFixed(1)}s)`);
        } else {
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
            console.log("  ⚠️  No speech detected. Returning to wake word mode.");
            console.log("");
            console.log("🎙️  Listening for \"Jarvis\"...");
            listener.start(onWakeWordDetected);
            return;
        }

        console.log(`  📝 Transcript (${sttEngine}): "${transcript}"`);
        tray.updateState({ lastTranscript: transcript });

        // Execute with ADK
        tray.updateState({ status: "planning" });
        showOverlay({ text: "Thinking...", title: "Jarvis" });
        console.log("  🤖 Thinking (ADK Runner)...");

        const { runner, sessionId } = await getAdkRunner();
        const request = {
            userId: "default_user",
            sessionId,
            newMessage: { role: "user", parts: [{ text: transcript }] }
        };

        let responseText = "";

        try {
            for await (const event of runner.runAsync(request)) {
                if (event.content && event.content.parts && event.content.parts.length > 0) {
                    const txt = event.content.parts[0].text;
                    if (txt) {
                        responseText += txt;
                    }
                }
            }
        } catch (adkErr) {
            console.error("  ❌ ADK Follow-up Error:", String(adkErr));
            responseText = "I encountered an internal error while processing that.";
        }

        console.log("");
        if (responseText) {
            console.log(`  ✅ ADK Response: ${responseText}`);
            tray.updateState({ status: "speaking", lastResponse: responseText });
            await speakResponse(responseText);
        } else {
            console.log("  ⚠️  No text response generated by ADK.");
            tray.updateState({ status: "speaking", lastResponse: "Done." });
            await speakResponse("Done.");
        }

        isProcessingCommand = false;
        tray.updateState({ status: "idle" });
        // Start another follow-up window
        await startFollowUpWindow();

    } catch (error) {
        console.warn(`  ⏱️  Follow-up error: ${String(error)}`);
        // Go back to wake word mode
        console.log("");
        console.log("🎙️  Listening for \"Jarvis\"...");
        isProcessingCommand = false;
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
console.log("║  Say \"Jarvis\" then speak a command    ║");
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
