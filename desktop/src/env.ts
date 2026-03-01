import { z } from "zod";

const optionalString = (minLength = 1) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(minLength).optional()
  );

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8765),
  AURA_AGENT_VERSION: z.string().min(1).default("0.2.0"),
  AURA_AUDIT_LOG_PATH: z.string().min(1).default("logs/desktop-agent.audit.log"),

  // Cloud Run backend
  AURA_BACKEND_URL: z.string().url().default("http://127.0.0.1:8080"),
  AURA_BACKEND_AUTH_TOKEN: optionalString(20),

  // whisper.cpp
  WHISPER_CPP_BIN: z.string().min(1).default("whisper-cli"),
  WHISPER_MODEL_PATH: optionalString(1)
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
