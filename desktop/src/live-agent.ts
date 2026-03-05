/**
 * AURA Live Agent — Gemini Live API entry point.
 *
 * Replaces the 5-step pipeline (wake word → record → STT → plan → TTS)
 * with a single persistent WebSocket session to Gemini Live API.
 *
 * ✅ Bidirectional audio streaming
 * ✅ Native interruptions (barge-in)
 * ✅ Tool calling via function declarations
 * ✅ Sub-second latency
 */

import { loadLocalDotenv } from "./localDotenv.js";
import { GoogleGenAI, Modality } from "@google/genai";
// @ts-ignore — no type definitions available for mic
import mic from "mic";
import Speaker from "speaker";
import { createWakeWordListener, resolveKeywordPath } from "./wakeWord.js";
import { toLiveFunctionDeclarations, executeLiveToolCall } from "./tools.js";
import { startTray } from "./trayMenu.js";
import { showOverlay, dismissOverlay } from "./overlay.js";
import { getHighlightedText } from "./clipboardHack.js";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Load environment variables
loadLocalDotenv();

// ── Config ──────────────────────────────────────────
const accessKey = process.env.PICOVOICE_ACCESS_KEY;
if (!accessKey) {
    console.error("❌ PICOVOICE_ACCESS_KEY is not set in .env");
    process.exit(1);
}

const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
if (!geminiApiKey) {
    console.error("❌ GEMINI_API_KEY is not set in .env");
    process.exit(1);
}

let keywordPath: string;
try {
    keywordPath = resolveKeywordPath();
    console.log(`📂 Wake word file: ${keywordPath}`);
} catch (error) {
    console.error("❌", String(error));
    process.exit(1);
}

// ── State ───────────────────────────────────────────
let isInSession = false;
let currentSession: any = null;
let micInstance: any = null;
let speaker: any = null;
const audioQueue: Buffer[] = [];

// ── System Tray ─────────────────────────────────────
const tray = startTray({
    geminiConnected: true,
    ttsEngine: "Gemini Live (native)",
    onQuit: () => {
        console.log("\n🛑 Quit from tray menu.");
        listener.stop();
        cleanup();
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

// ── Audio helpers ───────────────────────────────────
async function playSound(soundFile: string): Promise<void> {
    if (process.platform !== "darwin") return;
    return new Promise((resolve) => {
        const child = spawn("afplay", [soundFile], { stdio: "ignore" });
        child.on("error", () => resolve());
        child.on("exit", () => resolve());
    });
}

async function playListeningChime(): Promise<void> {
    const chimePath = resolve(process.cwd(), "desktop", "assets", "wake-chime.wav");
    await playSound(chimePath);
}

function createSpeaker(): any {
    if (speaker) {
        try { speaker.end(); } catch { }
        speaker = null;
    }
    speaker = new Speaker({
        channels: 1,
        bitDepth: 16,
        sampleRate: 24000,
    });
    speaker.on("error", (err: Error) => {
        // Suppress underflow warnings; speaker lib is noisy
    });
    return speaker;
}

function stopSpeaker(): void {
    if (speaker) {
        try { speaker.end(); } catch { }
        speaker = null;
    }
}

function stopMic(): void {
    if (micInstance) {
        try { micInstance.stop(); } catch { }
        micInstance = null;
    }
}

function cleanup(): void {
    stopMic();
    stopSpeaker();
    if (currentSession) {
        try { currentSession.close(); } catch { }
        currentSession = null;
    }
    audioQueue.length = 0;
    isInSession = false;
}

// ── Build system prompt ─────────────────────────────
function buildSystemInstruction(): string {
    return `You are Jarvis, a voice-controlled AI assistant for macOS built by Oluwaferanmi. You control the user's computer using tools.

You have these tools available:
- open_app(name) — Open a macOS app
- open_path(path) — Open a file or folder
- open_url(url) — Open a URL in the default browser
- find_and_open(query, root?) — Search for and open a file by name
- web_search(query) — Search the web for real-time info
- play_spotify(song, artist?) — Play a song on Spotify
- show_context_panel(text, title?) — Display text in a popover near the cursor
- execute_applescript(script) — Run AppleScript for system control
- focus_app(name) — Focus an app window
- click_menu(menu_path, app_name?) — Click a menu item
- type_text(text) — Type text into the focused element
- press_key(keys) — Press keyboard shortcuts
- trash(path) — Move a file to trash

RULES:
1. You are speaking to the user in real-time via voice. Keep your responses SHORT and conversational.
2. When the user asks you to do something on their computer, call the appropriate tool.
3. After a tool succeeds, confirm briefly: "Done", "Opening Safari", "Playing the song", etc.
4. For questions about real-time info (weather, prices, news), use web_search.
5. For general knowledge questions, answer directly from your training data.
6. If asked to play a song on Spotify, use play_spotify.
7. If asked to "explain this" and there is highlighted text, use show_context_panel.
8. Be personable and concise — you're a voice assistant, not a text chatbot.`;
}

// ── Gemini Live Session ─────────────────────────────
async function startLiveSession(): Promise<void> {
    if (isInSession) {
        console.log("⏳ Already in a session, ignoring.");
        return;
    }

    isInSession = true;
    listener.stop();

    await new Promise(r => setTimeout(r, 100));
    await playListeningChime();

    tray.updateState({ status: "recording" });
    console.log("  🎙️  Live session starting...");

    // Check for highlighted text
    const selectedText = await getHighlightedText();
    if (selectedText) {
        console.log(`     📋 [Detected ${selectedText.length} chars selected]`);
    }

    // Build config
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const functionDeclarations = toLiveFunctionDeclarations();

    let systemInstruction = buildSystemInstruction();
    if (selectedText) {
        systemInstruction += `\n\n[Currently Highlighted Text]\n${selectedText}`;
    }

    const config: any = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: systemInstruction,
        tools: [{ functionDeclarations }],
    };

    const responseQueue: any[] = [];

    // Helper to wait for a message
    async function waitMessage(): Promise<any> {
        while (responseQueue.length === 0) {
            await new Promise(r => setTimeout(r, 50));
            if (!isInSession) throw new Error("Session ended");
        }
        return responseQueue.shift();
    }

    // Audio playback loop
    let playbackRunning = true;
    async function playbackLoop(): Promise<void> {
        while (playbackRunning) {
            if (audioQueue.length === 0) {
                if (speaker) {
                    stopSpeaker();
                }
                await new Promise(r => setTimeout(r, 30));
            } else {
                if (!speaker) createSpeaker();
                const chunk = audioQueue.shift()!;
                await new Promise<void>(resolveWrite => {
                    if (speaker && !speaker.destroyed) {
                        const canContinue = speaker.write(chunk, () => resolveWrite());
                        if (!canContinue) {
                            speaker.once("drain", () => resolveWrite());
                        }
                    } else {
                        resolveWrite();
                    }
                });
            }
        }
    }

    // Message processing loop
    async function messageLoop(): Promise<void> {
        while (isInSession) {
            let message: any;
            try {
                message = await waitMessage();
            } catch {
                break;
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
                console.log("  ⚡ User interrupted — flushing audio");
                audioQueue.length = 0;
                stopSpeaker();
                continue;
            }

            // Handle audio output from model
            if (message.serverContent?.modelTurn?.parts) {
                tray.updateState({ status: "speaking" });
                for (const part of message.serverContent.modelTurn.parts) {
                    if (part.inlineData?.data) {
                        audioQueue.push(Buffer.from(part.inlineData.data, "base64"));
                    }
                }
            }

            // Handle tool calls
            if (message.toolCall) {
                tray.updateState({ status: "executing" });
                const functionResponses: any[] = [];

                for (const fc of message.toolCall.functionCalls) {
                    console.log(`  🔧 Tool call: ${fc.name}(${JSON.stringify(fc.args)})`);
                    const result = await executeLiveToolCall(fc.name, fc.args ?? {});
                    console.log(`  ${result.startsWith("Error") ? "❌" : "✅"} ${result}`);
                    functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result },
                    });
                }

                // Send tool responses back to Gemini
                currentSession.sendToolResponse({ functionResponses });
                tray.updateState({ status: "speaking" });
            }

            // Handle turn complete
            if (message.serverContent?.turnComplete) {
                console.log("  ✅ Turn complete");
                // Wait for audio to finish playing
                await new Promise(r => setTimeout(r, 500));
                while (audioQueue.length > 0) {
                    await new Promise(r => setTimeout(r, 100));
                }
                await new Promise(r => setTimeout(r, 1000));
                stopSpeaker();
            }
        }
    }

    try {
        // Connect to Gemini Live API
        console.log("  🌐 Connecting to Gemini Live API...");
        const session = await ai.live.connect({
            model: "gemini-2.5-flash-native-audio-preview-12-2025",
            config,
            callbacks: {
                onopen: () => {
                    console.log("  ✅ Connected to Gemini Live API");
                    tray.updateState({ status: "recording" });
                },
                onmessage: (message: any) => {
                    responseQueue.push(message);
                },
                onerror: (e: any) => {
                    console.error("  ❌ Live API error:", e.message || e);
                },
                onclose: (e: any) => {
                    console.log("  🔌 Live API connection closed:", e?.reason || "unknown");
                    isInSession = false;
                },
            },
        });

        currentSession = session;

        // Start background loops
        const playbackPromise = playbackLoop();
        const messagePromise = messageLoop();

        // Start microphone
        micInstance = mic({
            rate: "16000",
            bitwidth: "16",
            channels: "1",
            encoding: "signed-integer",
        });

        const micStream = micInstance.getAudioStream();
        micStream.on("data", (data: Buffer) => {
            if (currentSession && isInSession) {
                try {
                    currentSession.sendRealtimeInput({
                        audio: {
                            data: data.toString("base64"),
                            mimeType: "audio/pcm;rate=16000",
                        },
                    });
                } catch { }
            }
        });

        micStream.on("error", (err: Error) => {
            console.error("  ⚠️  Mic error:", err.message);
        });

        micInstance.start();
        console.log("  🎙️  Microphone active — speak now! (session will auto-close after silence)");
        showOverlay({ text: "Listening...", dismissAfterSec: 120 });

        // Wait for session to complete (auto-closes after extended silence or error)
        // Set a max session duration of 5 minutes
        const maxSessionMs = 5 * 60 * 1000;
        const timeout = setTimeout(() => {
            console.log("  ⏰ Max session duration reached, closing...");
            isInSession = false;
        }, maxSessionMs);

        // Wait until session ends
        while (isInSession) {
            await new Promise(r => setTimeout(r, 200));
        }

        clearTimeout(timeout);
        playbackRunning = false;

        // Cleanup
        cleanup();
        dismissOverlay();
        console.log("  🔚 Session ended.\n");

    } catch (error) {
        console.error("  ❌ Live session error:", String(error));
        cleanup();
        dismissOverlay();
    }

    // Restart wake word listener
    tray.updateState({ status: "idle" });
    listener.start(onWakeWordDetected);
}

// ── Wake word handler ───────────────────────────────
async function onWakeWordDetected(): Promise<void> {
    console.log();
    console.log("═══════════════════════════════════════");
    console.log("  🗣️  Jarvis! — Live session...          ");
    console.log("═══════════════════════════════════════");

    try {
        await startLiveSession();
    } catch (error) {
        console.error("❌ Session error:", String(error));
        cleanup();
        tray.updateState({ status: "idle" });
        listener.start(onWakeWordDetected);
    }
}

// ── Boot ────────────────────────────────────────────
console.log();
console.log("╔═══════════════════════════════════════╗");
console.log("║    🌟 AURA Live Agent                  ║");
console.log("║    Gemini Live API — Real-Time Voice    ║");
console.log("╠═══════════════════════════════════════╣");
console.log("║  Say \"Jarvis\" then speak naturally     ║");
console.log("║  Interrupt anytime • Press Ctrl+C exit  ║");
console.log("╚═══════════════════════════════════════╝");
console.log(`  Gemini: ✅ Live API`);
console.log(`  TTS: ✅ Gemini Native Audio`);
console.log();

listener.start(onWakeWordDetected);

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down AURA Live Agent...");
    cleanup();
    listener.stop();
    console.log("🔇 Wake word listener stopped.");
    process.exit(0);
});

