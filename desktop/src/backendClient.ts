import type { Env } from "./env.js";

function authHeaders(env: Env): Record<string, string> {
  return { authorization: `Bearer ${env.AURA_BACKEND_AUTH_TOKEN}` };
}

export async function backendPlan(args: {
  env: Env;
  instruction: string;
  desktopState?: unknown;
  contextSnapshot?: unknown;
}): Promise<unknown> {
  const res = await fetch(new URL("/plan", args.env.AURA_BACKEND_URL), {
    method: "POST",
    headers: {
      ...authHeaders(args.env),
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
  return res.json();
}

export async function backendTts(args: { env: Env; text: string }): Promise<ArrayBuffer> {
  const res = await fetch(new URL("/tts", args.env.AURA_BACKEND_URL), {
    method: "POST",
    headers: {
      ...authHeaders(args.env),
      "content-type": "application/json"
    },
    body: JSON.stringify({ text: args.text })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`backend /tts failed: ${res.status} ${text}`);
  }
  return res.arrayBuffer();
}

