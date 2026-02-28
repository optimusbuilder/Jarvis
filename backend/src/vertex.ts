import type { Env } from "./env.js";
import { actionPlanSchema } from "./schemas.js";

export interface VertexPlanner {
  plan(args: { instruction: string; context?: unknown; state?: unknown }): Promise<unknown>;
}

type MetadataTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

async function getAccessToken(): Promise<string> {
  // Cloud Run (and most GCP runtimes) expose an access token via the metadata server.
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

type VertexGenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

export function createVertexPlanner(env: Env): VertexPlanner {
  if (!env.GOOGLE_CLOUD_PROJECT || !env.AURA_GEMINI_MODEL) {
    throw new Error("Vertex planner requires GOOGLE_CLOUD_PROJECT and AURA_GEMINI_MODEL");
  }
  const project = env.GOOGLE_CLOUD_PROJECT;
  const model = env.AURA_GEMINI_MODEL;

  return {
    async plan({ instruction, context, state }) {
      const system = [
        "You are AURA, a careful computer-control planner.",
        "Return ONLY a single JSON object matching this schema:",
        "{ goal: string, questions: string[], tool_calls: { name: string, args: object }[] }",
        "If anything is ambiguous or risky, add a question and do not include tool_calls that could be destructive.",
        "Never include markdown. Never include explanations outside JSON."
      ].join("\n");

      const payload = JSON.stringify(
        { instruction, desktop_state: state ?? null, context_snapshot: context ?? null },
        null,
        2
      );

      const token = await getAccessToken();
      const url = vertexGenerateContentUrl({
        project,
        location: env.GOOGLE_CLOUD_LOCATION,
        model
      });

      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: system + "\n\n" + payload }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: "application/json"
          }
        })
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Vertex generateContent failed: ${res.status} ${body}`);
      }

      const json = (await res.json()) as VertexGenerateContentResponse;
      const text =
        json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("")?.trim() ?? "";

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Model did not return valid JSON");
      }

      const validated = actionPlanSchema.safeParse(parsed);
      if (!validated.success) {
        throw new Error("Model JSON did not match action plan schema");
      }

      return validated.data;
    }
  };
}
