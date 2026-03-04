/**
 * Conversation Memory — rolling buffer with summarization.
 *
 * Keeps the last N exchanges (user transcript + assistant response).
 * When the buffer fills up, summarizes all exchanges into a compact
 * context string via Gemini, then clears the buffer.
 *
 * This gives Jarvis conversational continuity across follow-ups.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

export type ConversationTurn = {
    role: "user" | "assistant";
    content: string;
};

const MAX_TURNS = 14; // 7 exchanges × 2 (user + assistant)

let conversationBuffer: ConversationTurn[] = [];
let contextSummary: string = "";

/**
 * Add a user message to the conversation buffer.
 */
export function addUserTurn(transcript: string): void {
    conversationBuffer.push({ role: "user", content: transcript });
}

/**
 * Add an assistant response to the conversation buffer.
 */
export function addAssistantTurn(response: string): void {
    conversationBuffer.push({ role: "assistant", content: response });
}

/**
 * Get the current conversation context as a formatted string.
 * Includes the summary of older conversations + recent turns.
 */
export function getConversationContext(): string {
    const parts: string[] = [];

    if (contextSummary) {
        parts.push(`[Previous conversation summary] ${contextSummary}`);
    }

    if (conversationBuffer.length > 0) {
        const recent = conversationBuffer
            .map(t => `${t.role === "user" ? "User" : "Jarvis"}: ${t.content}`)
            .join("\n");
        parts.push(recent);
    }

    return parts.join("\n\n");
}

/**
 * Check if the buffer is full and needs summarization.
 * If so, summarize and compact the buffer.
 */
export async function compactIfNeeded(geminiApiKey?: string): Promise<void> {
    if (conversationBuffer.length < MAX_TURNS) return;
    if (!geminiApiKey) {
        // No API key — just keep the last 4 turns and drop the rest
        conversationBuffer = conversationBuffer.slice(-4);
        return;
    }

    try {
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 300,
            },
        });

        const transcript = conversationBuffer
            .map(t => `${t.role === "user" ? "User" : "Jarvis"}: ${t.content}`)
            .join("\n");

        const existingContext = contextSummary
            ? `Previous context: ${contextSummary}\n\n`
            : "";

        const prompt = `${existingContext}Summarize this conversation in 2-3 sentences. Capture the key topics discussed, any user preferences mentioned, and important facts. Be concise:\n\n${transcript}`;

        const result = await model.generateContent(prompt);
        contextSummary = result.response.text().trim();

        // Keep last 2 turns for immediate continuity
        conversationBuffer = conversationBuffer.slice(-2);

        console.log(`  📝 Conversation compacted. Summary: "${contextSummary.slice(0, 100)}..."`);
    } catch (error) {
        console.warn(`  ⚠️  Failed to summarize conversation: ${String(error)}`);
        // Fallback: just keep the last 4 turns
        conversationBuffer = conversationBuffer.slice(-4);
    }
}

/**
 * Clear all conversation memory.
 */
export function clearMemory(): void {
    conversationBuffer = [];
    contextSummary = "";
}
