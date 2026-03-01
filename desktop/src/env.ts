import { z } from "zod";

const optionalString = (minLength = 1) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(minLength).optional()
  );

const optionalBoolean = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) return true;
      if (["0", "false", "no", "off"].includes(normalized)) return false;
    }
    return defaultValue;
  }, z.boolean());

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8765),
  AURA_AGENT_VERSION: z.string().min(1).default("0.2.0"),
  AURA_AUDIT_LOG_PATH: z.string().min(1).default("logs/desktop-agent.audit.log"),

  // Cloud Run backend
  AURA_BACKEND_URL: z.string().url().default("http://127.0.0.1:8080"),
  AURA_BACKEND_AUTH_TOKEN: optionalString(20),

  // whisper.cpp
  WHISPER_CPP_BIN: z.string().min(1).default("whisper-cli"),
  WHISPER_MODEL_PATH: optionalString(1),
  WHISPER_DEFAULT_LANGUAGE: z.string().min(2).max(12).default("en"),
  WHISPER_NO_GPU: optionalBoolean(true),
  WHISPER_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),

  // STT quality heuristics
  AURA_STT_MIN_WORDS: z.coerce.number().int().positive().default(2),
  AURA_STT_MIN_CHARS: z.coerce.number().int().positive().default(8),

  // Browser automation
  AURA_BROWSER_MODE: z.enum(["http", "playwright"]).default("http"),
  AURA_BROWSER_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  AURA_BROWSER_HEADLESS: optionalBoolean(true),

  // Filesystem tool safety
  AURA_ALLOWED_PATHS: optionalString(1),
  AURA_SEARCH_MAX_SCAN: z.coerce.number().int().positive().default(5000),

  // Local audio playback
  AURA_AUDIO_PLAYER_CMD: optionalString(1)
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
