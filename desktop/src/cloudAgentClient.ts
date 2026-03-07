import type { Env } from "./env.js";
import type { AgentTurnRequest, AgentTurnResponse } from "./schemas.js";

function authHeaders(env: Env): Record<string, string> {
    if (!env.AURA_BACKEND_AUTH_TOKEN) return {};
    return { authorization: `Bearer ${env.AURA_BACKEND_AUTH_TOKEN}` };
}

export async function createAgentSession(env: Env): Promise<string> {
    const url = `${env.AURA_BACKEND_URL}/agent/session`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            ...authHeaders(env),
            "content-type": "application/json",
        },
        body: JSON.stringify({}),
    });

    if (!res.ok) {
        throw new Error(`Failed to create agent session: ${res.status}`);
    }

    const json = (await res.json()) as { session_id: string };
    return json.session_id;
}

export async function agentTurn(
    env: Env,
    request: AgentTurnRequest
): Promise<AgentTurnResponse> {
    const url = `${env.AURA_BACKEND_URL}/agent/turn`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            ...authHeaders(env),
            "content-type": "application/json",
        },
        body: JSON.stringify(request),
    });

    if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(`Agent turn failed: ${res.status} ${errorText}`);
    }

    return (await res.json()) as AgentTurnResponse;
}
