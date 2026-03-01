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
  const language = args.language ?? args.env.WHISPER_DEFAULT_LANGUAGE;
  const commandArgs: string[] = [];
  if (args.env.WHISPER_NO_GPU) commandArgs.push("-ng");
  commandArgs.push(
    "-m",
    model,
    "-f",
    args.audioPath,
    "--language",
    language,
    "--no-timestamps",
    "--no-prints"
  );

  const { stdout } = await execFileAsync(args.env.WHISPER_CPP_BIN, commandArgs, {
    timeout: args.env.WHISPER_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024
  });

  return stdout.trim();
}
