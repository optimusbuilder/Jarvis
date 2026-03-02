/**
 * TTS Engine — Text-to-Speech for AURA voice responses.
 *
 * Supports two backends:
 * 1. ElevenLabs API — high-quality, natural TTS (requires API key)
 * 2. macOS `say` command — free, offline fallback
 *
 * The engine writes audio to a temp file and plays it via `afplay`.
 */

import { execFile } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type TTSConfig = {
    /** ElevenLabs API key (if not set, uses macOS `say` fallback) */
    elevenLabsApiKey?: string;
    /** ElevenLabs voice ID */
    elevenLabsVoiceId?: string;
    /** ElevenLabs model ID */
    elevenLabsModelId?: string;
};

export type TTSResult = {
    /** Which engine was used */
    engine: "elevenlabs" | "macos_say";
    /** Path to the audio file (if applicable) */
    audioPath?: string;
    /** Duration of playback in ms */
    durationMs: number;
};

/**
 * Speak text using ElevenLabs TTS.
 */
async function speakWithElevenLabs(args: {
    text: string;
    apiKey: string;
    voiceId: string;
    modelId?: string;
}): Promise<TTSResult> {
    const startMs = Date.now();

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(args.voiceId)}`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "xi-api-key": args.apiKey,
            "content-type": "application/json",
            accept: "audio/mpeg",
        },
        body: JSON.stringify({
            text: args.text,
            model_id: args.modelId ?? "eleven_flash_v2_5",
            voice_settings: { stability: 0.3, similarity_boost: 0.8 },
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`ElevenLabs TTS failed: ${res.status} ${body}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const audio = Buffer.from(arrayBuf);

    // Write to temp file
    const audioPath = resolve(tmpdir(), `aura-tts-${randomUUID()}.mp3`);
    await mkdir(dirname(audioPath), { recursive: true });
    await writeFile(audioPath, audio);

    // Play the audio
    await execFileAsync("afplay", [audioPath]);

    return {
        engine: "elevenlabs",
        audioPath,
        durationMs: Date.now() - startMs,
    };
}

/**
 * Speak text using macOS `say` command (free, offline fallback).
 */
async function speakWithMacosSay(text: string): Promise<TTSResult> {
    const startMs = Date.now();

    await execFileAsync("say", ["-v", "Samantha", "-r", "190", text]);

    return {
        engine: "macos_say",
        durationMs: Date.now() - startMs,
    };
}

/**
 * Speak text using the best available TTS engine.
 * Tries ElevenLabs first, falls back to macOS `say`.
 */
export async function speak(args: {
    text: string;
    config: TTSConfig;
}): Promise<TTSResult> {
    const { text, config } = args;

    if (!text.trim()) {
        return { engine: "macos_say", durationMs: 0 };
    }

    // Try ElevenLabs if configured
    if (config.elevenLabsApiKey && config.elevenLabsVoiceId) {
        try {
            return await speakWithElevenLabs({
                text,
                apiKey: config.elevenLabsApiKey,
                voiceId: config.elevenLabsVoiceId,
                modelId: config.elevenLabsModelId,
            });
        } catch (error) {
            console.warn(`  ⚠️  ElevenLabs TTS failed, falling back to macOS say: ${String(error)}`);
        }
    }

    // Fallback to macOS say
    if (process.platform === "darwin") {
        try {
            return await speakWithMacosSay(text);
        } catch (error) {
            console.warn(`  ⚠️  macOS say failed: ${String(error)}`);
        }
    }

    return { engine: "macos_say", durationMs: 0 };
}
