import { VertexAI } from "@google-cloud/vertexai";
import { z } from "zod";
import type { Env } from "./env.js";
import { actionPlanSchema } from "./schemas.js";

const vertexTextResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ text: z.string().optional() })).default([])
        })
      })
    )
    .default([])
});

export interface VertexPlanner {
  plan(args: { instruction: string; context?: unknown; state?: unknown }): Promise<unknown>;
}

export function createVertexPlanner(env: Env): VertexPlanner {
  const vertex = new VertexAI({
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.GOOGLE_CLOUD_REGION
  });

  const model = vertex.getGenerativeModel({
    model: env.AURA_GEMINI_MODEL,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
      responseMimeType: "application/json"
    }
  });

  return {
    async plan({ instruction, context, state }) {
      const prompt = JSON.stringify(
        {
          instruction,
          desktop_state: state ?? null,
          context_snapshot: context ?? null,
          output_schema: "action_plan_v1"
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

      const response = await model.generateContent({
        contents: [
          { role: "user", parts: [{ text: system + "\n\n" + prompt }] }
        ]
      });

      const parsed = vertexTextResponseSchema.safeParse(response.response);
      if (!parsed.success) {
        throw new Error("Vertex response shape unexpected");
      }

      const text =
        parsed.data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

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

