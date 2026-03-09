import type { Env } from "./env.js";
import { logError, logInfo } from "./logging.js";
import { toolDeclarations } from "./toolDeclarations.js";
import { globalSessionStore } from "./agentSessions.js";
import type { AgentTurnRequest, AgentTurnResponse } from "./schemas.js";
import type { Content, GenerateContentResponse } from "@google/generative-ai";

type MetadataTokenResponse = {
    access_token: string;
    expires_in: number;
    token_type: string;
};

async function getAccessToken(): Promise<string> {
    const url =
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
    const res = await fetch(url, {
        headers: { "metadata-flavor": "Google" }
    });
    if (!res.ok) {
        throw new Error(`metadata token fetch failed: ${res.status}`);
    }
    const json = (await res.json()) as MetadataTokenResponse;
    if (!json?.access_token) {
        throw new Error("metadata token response missing access_token");
    }
    return json.access_token;
}

function vertexBaseUrl(location: string): string {
    if (location === "global") return "https://aiplatform.googleapis.com";
    return `https://${location}-aiplatform.googleapis.com`;
}

function vertexGenerateContentUrl(args: { project: string; location: string; model: string }): string {
    const base = vertexBaseUrl(args.location);
    const encodedModel = encodeURIComponent(args.model);
    return (
        `${base}/v1/projects/${encodeURIComponent(args.project)}` +
        `/locations/${encodeURIComponent(args.location)}` +
        `/publishers/google/models/${encodedModel}:generateContent`
    );
}

export async function runAgentTurn(
    env: Env,
    request: AgentTurnRequest,
    requestId?: string
): Promise<AgentTurnResponse> {
    if (!env.GOOGLE_CLOUD_PROJECT || !env.AURA_GEMINI_MODEL) {
        throw new Error("Agent runner requires GOOGLE_CLOUD_PROJECT and AURA_GEMINI_MODEL");
    }

    const session = globalSessionStore.getSession(request.session_id);
    if (!session) {
        throw new Error("Session not found or expired");
    }

    const startedAt = Date.now();
    logInfo("agent_turn_start", {
        session_id: request.session_id,
        request_id: requestId ?? null,
        has_user_message: !!request.user_message,
        num_tool_results: request.tool_results?.length ?? 0
    });

    // 1. Append new user message or tool results to history
    if (request.user_message) {
        session.messages.push({
            role: "user",
            parts: [{ text: request.user_message }]
        });
    }

    if (request.tool_results && request.tool_results.length > 0) {
        session.messages.push({
            role: "user",
            parts: request.tool_results.map(tr => ({
                functionResponse: {
                    name: tr.tool_name,
                    response: typeof tr.result === "object" ? tr.result : { result: tr.result }
                }
            }))
        });
    }

    const systemInstruction = `You are Jarvis, a voice-controlled computer assistant for macOS built by Oluwaferanmi.
You control the user's computer using the provided tools.
You are speaking to the user in real-time via voice. Keep your non-tool responses SHORT and conversational.
When the user asks you to do something on their computer, ALWAYS call the appropriate tool.
After a tool succeeds, confirm briefly: "Done", "Opening Safari", etc.
For questions about real-time info, use web_search.
If asked to "explain this" and there is highlighted text, use show_context_panel.
If a user asks to do something on their Mac that isn't covered by a specific tool (like sending an iMessage or changing brightness), you MUST write the native AppleScript code to accomplish it yourself and pass it to the execute_applescript tool. Do NOT ask the user for the script.`;

    const url = vertexGenerateContentUrl({
        project: env.GOOGLE_CLOUD_PROJECT,
        location: env.GOOGLE_CLOUD_LOCATION,
        model: env.AURA_GEMINI_MODEL
    });

    const token = await getAccessToken();

    const body = {
        contents: session.messages,
        systemInstruction: {
            role: "system",
            parts: [{ text: systemInstruction }]
        },
        tools: [{ functionDeclarations: toolDeclarations }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024
        }
    };

    const res = await fetch(url, {
        method: "POST",
        headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        logError("vertex_agent_http_error", { status: res.status, errorText });
        throw new Error(`Vertex generateContent failed: ${res.status} ${errorText}`);
    }

    const json = (await res.json()) as any;
    const candidate = json?.candidates?.[0];
    const messageContent = candidate?.content;

    if (!messageContent || !messageContent.parts) {
        throw new Error("Model returned empty or invalid response");
    }

    // 2. Append the model's exact response to history
    session.messages.push(messageContent);

    logInfo("agent_turn_success", {
        session_id: request.session_id,
        duration_ms: Date.now() - startedAt
    });

    // 3. Parse the parts to see if it's text or function calls
    const functionCalls = messageContent.parts.filter((p: any) => !!p.functionCall).map((p: any) => p.functionCall);

    if (functionCalls.length > 0) {
        return {
            type: "tool_calls",
            session_id: request.session_id,
            tool_calls: functionCalls.map((fc: any) => ({
                name: fc.name,
                args: fc.args || {}
            }))
        };
    }

    const textParts = messageContent.parts.filter((p: any) => !!p.text).map((p: any) => p.text);
    const text = textParts.join("\n").trim();

    return {
        type: "done",
        session_id: request.session_id,
        text: text || "Done."
    };
}
