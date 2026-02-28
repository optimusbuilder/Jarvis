import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8765),

  // Cloud Run backend
  AURA_BACKEND_URL: z.string().url().default("http://127.0.0.1:8080"),
  AURA_BACKEND_AUTH_TOKEN: z.string().min(20).optional(),

  // whisper.cpp
  WHISPER_CPP_BIN: z.string().min(1).default("whisper-cli"),
  WHISPER_MODEL_PATH: z.string().min(1).optional()
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
