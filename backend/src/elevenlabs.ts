import type { Env } from "./env.js";

export async function elevenLabsTts(args: {
  env: Env;
  voiceId: string;
  text: string;
}): Promise<{ contentType: string; audio: Buffer }> {
  if (!args.env.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY not configured");
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(args.voiceId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": args.env.ELEVENLABS_API_KEY,
      "content-type": "application/json",
      accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text: args.text,
      model_id: args.env.ELEVENLABS_MODEL_ID,
      voice_settings: { stability: 0.3, similarity_boost: 0.8 }
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${body}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const audio = Buffer.from(arrayBuf);
  const contentType = res.headers.get("content-type") ?? "audio/mpeg";
  return { contentType, audio };
}

