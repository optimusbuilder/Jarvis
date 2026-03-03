/**
 * TTS Engine — Text-to-Speech for AURA voice responses.
 *
 * Supports two backends:
 * 1. ElevenLabs API (STREAMING) — pipes audio chunks directly to ffplay
 *    for near-instant playback. First audio heard in ~500ms.
 * 2. macOS `say` command — free, offline fallback
 */

import { spawn, execFile } from "node:child_process";
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
    /** Duration of playback in ms */
    durationMs: number;
};

/**
 * Speak text using ElevenLabs TTS with STREAMING playback.
 * Pipes audio chunks directly to ffplay — first words heard in ~500ms.
 */
async function speakWithElevenLabs(args: {
    text: string;
    apiKey: string;
    voiceId: string;
    modelId?: string;
}): Promise<TTSResult> {
    const startMs = Date.now();

    // Use the STREAMING endpoint
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(args.voiceId)}/stream`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "xi-api-key": args.apiKey,
            "content-type": "application/json",
            accept: "audio/mpeg",
        },
        body: JSON.stringify({
            text: args.text,
            model_id: args.modelId ?? "eleven_turbo_v2_5",
            voice_settings: { stability: 0.3, similarity_boost: 0.8, speed: 1.15 },
            optimize_streaming_latency: 3, // max optimization
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`ElevenLabs TTS failed: ${res.status} ${body}`);
    }

    if (!res.body) {
        throw new Error("ElevenLabs returned no response body for streaming");
    }

    // Pipe the audio stream directly to ffplay for instant playback
    return new Promise<TTSResult>((resolve, reject) => {
        const player = spawn("ffplay", [
            "-nodisp",       // no video display
            "-autoexit",     // exit when done
            "-loglevel", "quiet",
            "-f", "mp3",     // input format
            "-i", "pipe:0",  // read from stdin
        ], { stdio: ["pipe", "ignore", "ignore"] });

        let finished = false;

        player.on("close", (code) => {
            finished = true;
            resolve({
                engine: "elevenlabs",
                durationMs: Date.now() - startMs,
            });
        });

        player.on("error", (err) => {
            if (!finished) {
                finished = true;
                reject(err);
            }
        });

        // Stream the response body chunks directly to ffplay's stdin
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();

        async function pump(): Promise<void> {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    player.stdin.end();
                    return;
                }
                if (!player.stdin.destroyed) {
                    const canContinue = player.stdin.write(Buffer.from(value));
                    if (!canContinue) {
                        await new Promise<void>(r => player.stdin.once("drain", r));
                    }
                }
            }
        }

        pump().catch(err => {
            if (!finished) {
                player.stdin.end();
            }
        });
    });
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
 * Tries ElevenLabs (streaming) first, falls back to macOS `say`.
 */
export async function speak(args: {
    text: string;
    config: TTSConfig;
}): Promise<TTSResult> {
    const { text, config } = args;

    if (!text.trim()) {
        return { engine: "macos_say", durationMs: 0 };
    }

    // Try ElevenLabs streaming if configured
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
