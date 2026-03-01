import type { Env } from "./env.js";

function authHeaders(env: Env): Record<string, string> {
  if (!env.AURA_BACKEND_AUTH_TOKEN) return {};
  return { authorization: `Bearer ${env.AURA_BACKEND_AUTH_TOKEN}` };
}

export async function backendPlan(args: {
  env: Env;
  instruction: string;
  desktopState?: unknown;
  contextSnapshot?: unknown;
  requestId?: string;
}): Promise<{ payload: unknown; requestId: string | null }> {
  const res = await fetch(new URL("/plan", args.env.AURA_BACKEND_URL), {
    method: "POST",
    headers: {
      ...authHeaders(args.env),
      ...(args.requestId ? { "x-request-id": args.requestId } : {}),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      instruction: args.instruction,
      desktop_state: args.desktopState,
      context_snapshot: args.contextSnapshot
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`backend /plan failed: ${res.status} ${text}`);
  }
  return {
    payload: await res.json(),
    requestId: res.headers.get("x-request-id")
  };
}

export async function backendTts(args: {
  env: Env;
  text: string;
  voiceId?: string;
}): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const res = await fetch(new URL("/tts", args.env.AURA_BACKEND_URL), {
    method: "POST",
    headers: {
      ...authHeaders(args.env),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      text: args.text,
      voice_id: args.voiceId
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`backend /tts failed: ${res.status} ${text}`);
  }
  return {
    audio: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "audio/mpeg"
  };
}
