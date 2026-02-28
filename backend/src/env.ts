import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),

  // Auth
  AURA_BACKEND_AUTH_TOKEN: z.string().min(20).optional(),

  // Modes (local-first)
  AURA_PLANNER_MODE: z.enum(["local", "vertex"]).default("local"),
  AURA_TTS_MODE: z.enum(["stub", "elevenlabs"]).default("stub"),

  // Vertex AI (required only when AURA_PLANNER_MODE=vertex)
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  GOOGLE_CLOUD_LOCATION: z.string().min(1).default("global"),
  AURA_GEMINI_MODEL: z.string().min(1).optional(),

  // ElevenLabs
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_VOICE_ID: z.string().min(1).optional(),
  ELEVENLABS_MODEL_ID: z.string().min(1).optional()
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment variables: ${message}`);
  }

  const env = parsed.data;
  const issues: string[] = [];

  if (env.AURA_PLANNER_MODE === "vertex") {
    if (!env.GOOGLE_CLOUD_PROJECT) issues.push("GOOGLE_CLOUD_PROJECT is required when AURA_PLANNER_MODE=vertex");
    if (!env.AURA_GEMINI_MODEL) issues.push("AURA_GEMINI_MODEL is required when AURA_PLANNER_MODE=vertex");
  }

  if (env.AURA_TTS_MODE === "elevenlabs") {
    if (!env.ELEVENLABS_API_KEY) issues.push("ELEVENLABS_API_KEY is required when AURA_TTS_MODE=elevenlabs");
    if (!env.ELEVENLABS_VOICE_ID) issues.push("ELEVENLABS_VOICE_ID is required when AURA_TTS_MODE=elevenlabs");
  }

  if (issues.length) {
    throw new Error(`Invalid environment variables: ${issues.join("; ")}`);
  }

  return env;
}
