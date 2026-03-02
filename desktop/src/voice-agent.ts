/**
 * AURA Voice Agent — Main entry point.
 *
 * This is the single-process voice-first computer control agent.
 * Phase 1: Wake word detection only.
 * Future phases will add VAD recording, transcription, planning, execution, and TTS.
 */

import { loadLocalDotenv } from "./localDotenv.js";
import { createWakeWordListener, resolveKeywordPath } from "./wakeWord.js";

// Load environment variables
loadLocalDotenv();

const accessKey = process.env.PICOVOICE_ACCESS_KEY;
if (!accessKey) {
    console.error("❌ PICOVOICE_ACCESS_KEY is not set in .env");
    console.error("   Get a free key at https://console.picovoice.ai");
    process.exit(1);
}

// Resolve the wake word file
let keywordPath: string;
try {
    keywordPath = resolveKeywordPath();
    console.log(`📂 Wake word file: ${keywordPath}`);
} catch (error) {
    console.error("❌", String(error));
    process.exit(1);
}

// Create the wake word listener
const listener = createWakeWordListener({
    accessKey,
    keywordPath,
    sensitivity: 0.7,
    deviceIndex: -1,
});

// Track state
let isProcessingCommand = false;

function onWakeWordDetected(): void {
    if (isProcessingCommand) {
        console.log("⏳ Already processing a command, ignoring wake word.");
        return;
    }

    isProcessingCommand = true;
    console.log("");
    console.log("═══════════════════════════════════════");
    console.log("  🗣️  Hey Aura! — Wake word detected  ");
    console.log("═══════════════════════════════════════");
    console.log("  (Phase 2 will add: recording → transcription)");
    console.log("  (Phase 3 will add: planning)");
    console.log("  (Phase 4 will add: tool execution)");
    console.log("  (Phase 5 will add: TTS response)");
    console.log("");

    // Play a system sound to acknowledge (macOS)
    if (process.platform === "darwin") {
        import("node:child_process").then(({ execFile }) => {
            execFile("afplay", ["/System/Library/Sounds/Tink.aiff"], () => {
                // ignore audio errors
            });
        });
    }

    // For Phase 1, just reset after a short delay
    setTimeout(() => {
        isProcessingCommand = false;
        console.log("🎙️  Listening for wake word again...\n");
    }, 1500);
}

// Start the listener
console.log("");
console.log("╔═══════════════════════════════════════╗");
console.log("║     🌟 AURA Voice Agent — Phase 1     ║");
console.log("║     Wake Word Detection Active         ║");
console.log("╠═══════════════════════════════════════╣");
console.log("║  Say \"Hey Aura\" to test detection     ║");
console.log("║  Press Ctrl+C to exit                 ║");
console.log("╚═══════════════════════════════════════╝");
console.log("");

listener.start(onWakeWordDetected);

// Graceful shutdown
function shutdown(): void {
    console.log("\n🛑 Shutting down AURA Voice Agent...");
    listener.stop();
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
