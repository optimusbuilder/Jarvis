import { z } from "zod";

const optionalString = (minLength = 1) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(minLength).optional()
  );

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  AURA_BACKEND_VERSION: optionalString(1),

  // Auth
  AURA_BACKEND_AUTH_TOKEN: optionalString(20),

  // Modes (local-first)
  AURA_PLANNER_MODE: z.enum(["local", "vertex"]).default("local"),
  AURA_TTS_MODE: z.enum(["stub", "elevenlabs"]).default("stub"),

  // Vertex AI (required only when AURA_PLANNER_MODE=vertex)
  GOOGLE_CLOUD_PROJECT: optionalString(1),
  GOOGLE_CLOUD_LOCATION: z.string().min(1).default("global"),
  AURA_GEMINI_MODEL: optionalString(1),

  // ElevenLabs
  ELEVENLABS_API_KEY: optionalString(1),
  ELEVENLABS_VOICE_ID: optionalString(1),
  ELEVENLABS_MODEL_ID: optionalString(1)
});

export type Env = Omit<z.infer<typeof envSchema>, "AURA_BACKEND_VERSION"> & {
  AURA_BACKEND_VERSION: string;
};

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

  return {
    ...env,
    AURA_BACKEND_VERSION: env.AURA_BACKEND_VERSION ?? process.env.K_REVISION ?? "dev"
  };
}
