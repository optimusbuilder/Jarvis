import { GoogleGenAI } from "@google/genai";
import type { Env } from "./env.js";
import { actionPlanSchema } from "./schemas.js";

export interface VertexPlanner {
  plan(args: { instruction: string; context?: unknown; state?: unknown }): Promise<unknown>;
}

export function createVertexPlanner(env: Env): VertexPlanner {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.GOOGLE_CLOUD_LOCATION
  });

  return {
    async plan({ instruction, context, state }) {
      const payload = JSON.stringify(
        {
          instruction,
          desktop_state: state ?? null,
          context_snapshot: context ?? null
        },
        null,
        2
      );

      const system = [
        "You are AURA, a careful computer-control planner.",
        "Return ONLY a single JSON object matching this schema:",
        "{ goal: string, questions: string[], tool_calls: { name: string, args: object }[] }",
        "If anything is ambiguous or risky, add a question and do not include tool_calls that could be destructive.",
        "Never include markdown. Never include explanations outside JSON."
      ].join("\n");

      const response = await ai.models.generateContent({
        model: env.AURA_GEMINI_MODEL,
        contents: system + "\n\n" + payload,
        config: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: "application/json"
        }
      });

      const text = response.text;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Model did not return valid JSON");
      }

      const validated = actionPlanSchema.safeParse(json);
      if (!validated.success) {
        throw new Error("Model JSON did not match action plan schema");
      }

      return validated.data;
    }
  };
}

