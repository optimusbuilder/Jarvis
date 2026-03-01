import { execFile } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function extensionFromContentType(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("audio/wav") || normalized.includes("audio/x-wav")) return "wav";
  if (normalized.includes("audio/mpeg") || normalized.includes("audio/mp3")) return "mp3";
  if (normalized.includes("audio/ogg")) return "ogg";
  return "bin";
}

export async function writeAudioFile(args: {
  audio: ArrayBuffer;
  contentType: string;
  outputPath?: string;
}): Promise<{ audioPath: string; bytes: number }> {
  const extension = extensionFromContentType(args.contentType);
  const targetPath = args.outputPath?.trim()
    ? resolve(args.outputPath.trim())
    : resolve(tmpdir(), `aura-tts-${Date.now()}.${extension}`);
  await mkdir(dirname(targetPath), { recursive: true });

  const buf = Buffer.from(args.audio);
  await writeFile(targetPath, buf);
  return {
    audioPath: targetPath,
    bytes: buf.byteLength
  };
}

export async function playAudioFile(args: {
  audioPath: string;
  playerCommand?: string;
}): Promise<void> {
  const player = args.playerCommand?.trim() || (process.platform === "darwin" ? "afplay" : "");
  if (!player) throw new Error("audio_player_not_configured");
  await execFileAsync(player, [args.audioPath]);
}
