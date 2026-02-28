import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Env } from "./env.js";

const execFileAsync = promisify(execFile);

export async function transcribeWithWhisperCpp(args: {
  env: Env;
  audioPath: string;
  language?: string;
}): Promise<string> {
  const model = args.env.WHISPER_MODEL_PATH ?? "models/ggml-base.en.bin";
  const language = args.language ?? "en";

  const { stdout } = await execFileAsync(args.env.WHISPER_CPP_BIN, [
    "-m",
    model,
    "-f",
    args.audioPath,
    "--language",
    language,
    "--no-timestamps",
    "--no-prints"
  ]);

  return stdout.trim();
}

