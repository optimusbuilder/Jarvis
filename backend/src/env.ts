import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),

  // Auth
  AURA_BACKEND_AUTH_TOKEN: z.string().min(20).optional(),

  // Vertex AI
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GOOGLE_CLOUD_REGION: z.string().min(1).default("us-central1"),
  AURA_GEMINI_MODEL: z.string().min(1),

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
  return parsed.data;
}

