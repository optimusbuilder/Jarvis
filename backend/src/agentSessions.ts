import type { Content } from "@google/generative-ai";
import crypto from "node:crypto";

export interface ConversationHistory {
    id: string;
    messages: Content[];
    createdAt: number;
    lastAccessedAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class AgentSessionStore {
    private sessions = new Map<string, ConversationHistory>();

    public createSession(): ConversationHistory {
        this.cleanupTokens();

        // Generate an 8-character random ID
        const sessionId = crypto.randomBytes(4).toString('hex');
        const now = Date.now();

        const session: ConversationHistory = {
            id: sessionId,
            messages: [],
            createdAt: now,
            lastAccessedAt: now
        };

        this.sessions.set(sessionId, session);
        return session;
    }

    public getSession(id: string): ConversationHistory | undefined {
        this.cleanupTokens();
        const session = this.sessions.get(id);
        if (session) {
            session.lastAccessedAt = Date.now();
        }
        return session;
    }

    public appendMessage(id: string, message: Content): void {
        const session = this.getSession(id);
        if (session) {
            session.messages.push(message);
        }
    }

    private cleanupTokens(): void {
        const now = Date.now();
        for (const [id, session] of this.sessions.entries()) {
            if (now - session.lastAccessedAt > SESSION_TTL_MS) {
                this.sessions.delete(id);
            }
        }
    }
}

export const globalSessionStore = new AgentSessionStore();
