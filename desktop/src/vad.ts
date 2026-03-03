/**
 * Voice Activity Detection (VAD) — Silence-based recording cutoff.
 *
 * After the wake word is detected, this module:
 * 1. Records audio from the microphone using PvRecorder
 * 2. Monitors RMS energy levels in real-time
 * 3. Stops recording after sustained silence (~1.5s)
 * 4. Writes the captured audio to a WAV file for whisper.cpp
 */

import { PvRecorder } from "@picovoice/pvrecorder-node";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type VADConfig = {
    /** RMS energy threshold below which audio is considered silence (0.0–1.0 of 16-bit range). Default: 0.02 */
    silenceThreshold?: number;
    /** How long silence must persist before stopping (ms). Default: 1500 */
    silenceDurationMs?: number;
    /** Maximum recording duration (ms). Default: 15000 */
    maxDurationMs?: number;
    /** Minimum recording duration before silence cutoff applies (ms). Default: 500 */
    minDurationMs?: number;
    /** Sample rate (Hz). Must match whisper.cpp expectations. Default: 16000 */
    sampleRate?: number;
    /** Audio input device index, -1 = default */
    deviceIndex?: number;
    /** Max time (ms) to wait for speech to start. If no speech detected before this, return null. Used for follow-up window. */
    initialSilenceTimeoutMs?: number;
};

export type VADResult = {
    /** Path to the recorded WAV file */
    audioPath: string;
    /** Recording duration in milliseconds */
    durationMs: number;
    /** File size in bytes */
    bytes: number;
    /** Whether recording was stopped by silence detection (vs max duration) */
    stoppedBySilence: boolean;
};

/**
 * Calculate RMS (Root Mean Square) energy of a PCM audio frame.
 * Returns a value between 0.0 and 1.0 (normalized to 16-bit range).
 */
function calculateRMS(pcm: Int16Array): number {
    if (pcm.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) {
        const normalized = pcm[i] / 32768;
        sum += normalized * normalized;
    }
    return Math.sqrt(sum / pcm.length);
}

/**
 * Write PCM audio data as a WAV file.
 * Format: 16-bit, mono, 16kHz (default).
 */
function createWavBuffer(samples: Int16Array, sampleRate: number): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = samples.length * (bitsPerSample / 8);
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = Buffer.alloc(totalSize);
    let offset = 0;

    // RIFF header
    buffer.write("RIFF", offset); offset += 4;
    buffer.writeUInt32LE(totalSize - 8, offset); offset += 4;
    buffer.write("WAVE", offset); offset += 4;

    // fmt  chunk
    buffer.write("fmt ", offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4; // chunk size
    buffer.writeUInt16LE(1, offset); offset += 2;  // PCM format
    buffer.writeUInt16LE(numChannels, offset); offset += 2;
    buffer.writeUInt32LE(sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(byteRate, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

    // data chunk
    buffer.write("data", offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;

    // PCM samples
    for (let i = 0; i < samples.length; i++) {
        buffer.writeInt16LE(samples[i], offset);
        offset += 2;
    }

    return buffer;
}

/**
 * Record audio with voice activity detection.
 * Starts recording immediately and stops when silence is detected
 * or the maximum duration is reached.
 */
export async function recordWithVAD(config: VADConfig = {}): Promise<VADResult> {
    const silenceThreshold = config.silenceThreshold ?? 0.02;
    const silenceDurationMs = config.silenceDurationMs ?? 1500;
    const maxDurationMs = config.maxDurationMs ?? 15000;
    const minDurationMs = config.minDurationMs ?? 500;
    const sampleRate = config.sampleRate ?? 16000;
    const deviceIndex = config.deviceIndex ?? -1;
    const initialSilenceTimeoutMs = config.initialSilenceTimeoutMs ?? 0;

    // PvRecorder frame length — 512 samples at 16kHz = 32ms per frame
    const frameLength = 512;
    const recorder = new PvRecorder(frameLength, deviceIndex);
    const frameDurationMs = (frameLength / sampleRate) * 1000;

    const allSamples: Int16Array[] = [];
    let totalSamples = 0;
    let silenceStartMs: number | null = null;
    let stoppedBySilence = false;
    let speechDetected = false;

    const startedAt = Date.now();

    recorder.start();

    try {
        while (true) {
            const pcm = await recorder.read();
            allSamples.push(new Int16Array(pcm));
            totalSamples += pcm.length;

            const elapsedMs = Date.now() - startedAt;
            const rms = calculateRMS(pcm);

            // Check for silence
            if (rms < silenceThreshold) {
                if (silenceStartMs === null) {
                    silenceStartMs = Date.now();
                }
                const silentFor = Date.now() - silenceStartMs;

                // If waiting for initial speech and timeout is set, check it
                if (!speechDetected && initialSilenceTimeoutMs > 0 && elapsedMs >= initialSilenceTimeoutMs) {
                    // No speech was detected within the follow-up window
                    recorder.stop();
                    recorder.release();
                    return {
                        audioPath: "",
                        durationMs: 0,
                        bytes: 0,
                        stoppedBySilence: true,
                    };
                }

                // Only apply silence cutoff after minimum duration AND speech was detected
                if (speechDetected && elapsedMs >= minDurationMs && silentFor >= silenceDurationMs) {
                    stoppedBySilence = true;
                    break;
                }
            } else {
                // Speech detected, reset silence timer
                speechDetected = true;
                silenceStartMs = null;
            }

            // Check max duration
            if (elapsedMs >= maxDurationMs) {
                break;
            }
        }
    } finally {
        recorder.stop();
        recorder.release();
    }

    const durationMs = Date.now() - startedAt;

    // Merge all samples into one buffer
    const merged = new Int16Array(totalSamples);
    let writeOffset = 0;
    for (const chunk of allSamples) {
        merged.set(chunk, writeOffset);
        writeOffset += chunk.length;
    }

    // Write to WAV file
    const wavBuffer = createWavBuffer(merged, sampleRate);
    const audioPath = resolve(tmpdir(), `aura-vad-${randomUUID()}.wav`);
    await mkdir(dirname(audioPath), { recursive: true });
    await writeFile(audioPath, wavBuffer);

    return {
        audioPath,
        durationMs,
        bytes: wavBuffer.length,
        stoppedBySilence,
    };
}
