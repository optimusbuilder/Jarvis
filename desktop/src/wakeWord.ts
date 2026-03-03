import { Porcupine, BuiltinKeyword, getBuiltinKeywordPath } from "@picovoice/porcupine-node";
import { PvRecorder } from "@picovoice/pvrecorder-node";
import path from "node:path";
import fs from "node:fs";

export type WakeWordConfig = {
    accessKey: string;
    /** Absolute path to the .ppn keyword file */
    keywordPath: string;
    /** Sensitivity 0.0–1.0, higher = more sensitive but more false positives */
    sensitivity?: number;
    /** Audio input device index, -1 = default */
    deviceIndex?: number;
};

export type WakeWordListener = {
    /** Start listening for the wake word. Calls onDetected each time it's heard. */
    start: (onDetected: () => void) => void;
    /** Stop listening and release resources. */
    stop: () => void;
    /** Whether the listener is currently active. */
    isListening: () => boolean;
};

/**
 * Resolve the keyword .ppn file path.
 * Looks in the repo root directory for the Hey-Aura folder.
 */
export function resolveKeywordPath(): string {
    // Use built-in Jarvis keyword — no external .ppn file needed
    try {
        return getBuiltinKeywordPath(BuiltinKeyword.JARVIS);
    } catch {
        // Fallback: try Hey-Aura custom file
        const candidates = [
            path.resolve(process.cwd(), "Hey-Aura_en_mac_v4_0_0", "Hey-Aura_en_mac_v4_0_0.ppn"),
            path.resolve(process.cwd(), "..", "Hey-Aura_en_mac_v4_0_0", "Hey-Aura_en_mac_v4_0_0.ppn"),
            path.resolve(process.cwd(), "Hey-Aura_en_mac_v4_0_0.ppn"),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        throw new Error(
            `Wake word file not found. Built-in Jarvis keyword failed and no custom .ppn found.`
        );
    }
}

/**
 * Create a wake word listener using Picovoice Porcupine.
 */
export function createWakeWordListener(config: WakeWordConfig): WakeWordListener {
    const sensitivity = config.sensitivity ?? 0.7;

    if (!config.accessKey) {
        throw new Error("PICOVOICE_ACCESS_KEY is required. Get one free at https://console.picovoice.ai");
    }

    if (!fs.existsSync(config.keywordPath)) {
        throw new Error(`Wake word keyword file not found: ${config.keywordPath}`);
    }

    let porcupine: Porcupine | null = null;
    let recorder: PvRecorder | null = null;
    let listening = false;
    let shouldStop = false;

    return {
        start(onDetected: () => void) {
            if (listening) return;

            // Initialize Porcupine
            porcupine = new Porcupine(
                config.accessKey,
                [config.keywordPath],
                [sensitivity]
            );

            const frameLength = porcupine.frameLength;

            // Initialize recorder with Porcupine's required frame length
            recorder = new PvRecorder(frameLength, config.deviceIndex ?? -1);
            recorder.start();
            listening = true;
            shouldStop = false;

            console.log("🎙️  Listening for wake word \"Jarvis\"...");

            // Process audio frames in a loop
            const processFrame = async () => {
                if (shouldStop || !recorder || !porcupine) return;

                try {
                    const pcm = await recorder.read();
                    const keywordIndex = porcupine.process(pcm);

                    if (keywordIndex >= 0) {
                        console.log("✨ Wake word detected: \"Jarvis\"");
                        onDetected();
                    }
                } catch (error) {
                    if (!shouldStop) {
                        console.error("Wake word processing error:", error);
                    }
                }

                // Schedule next frame processing (non-blocking)
                if (!shouldStop) {
                    setImmediate(processFrame);
                }
            };

            // Start processing
            processFrame();
        },

        stop() {
            shouldStop = true;
            listening = false;

            if (recorder) {
                try {
                    recorder.stop();
                    recorder.release();
                } catch {
                    // ignore cleanup errors
                }
                recorder = null;
            }

            if (porcupine) {
                try {
                    porcupine.release();
                } catch {
                    // ignore cleanup errors
                }
                porcupine = null;
            }

            console.log("🔇 Wake word listener stopped.");
        },

        isListening() {
            return listening;
        }
    };
}
