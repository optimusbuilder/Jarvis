import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

export type PushToTalkCaptureResult = {
  audio_path: string;
  duration_ms: number;
  bytes: number;
};

export type PushToTalkCapture = {
  capture_id: string;
  audio_path: string;
  started_at: string;
  stop: () => Promise<PushToTalkCaptureResult>;
};

function resolveOutputPath(captureId: string, outputPath?: string): string {
  if (outputPath && outputPath.trim()) return resolve(outputPath.trim());
  return resolve(tmpdir(), `aura-ptt-${captureId}.wav`);
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolvePromise) => {
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolvePromise(code);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    proc.once("exit", (code) => finish(code));
  });
}

function waitForStart(proc: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finishOk = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise();
    };
    const finishErr = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(err);
    };
    const onError = (err: unknown) => finishErr(err);
    const onExit = (code: number | null) =>
      finishErr(new Error(`ffmpeg exited before capture start (code=${code ?? "null"})`));
    const timer = setTimeout(finishOk, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      proc.off("error", onError);
      proc.off("exit", onExit);
    };

    proc.once("error", onError);
    proc.once("exit", onExit);
  });
}

export async function startPushToTalkCapture(args: {
  outputPath?: string;
  inputDevice?: string;
}): Promise<PushToTalkCapture> {
  if (process.platform !== "darwin") {
    throw new Error("ptt_not_supported: only macOS is supported in v1");
  }

  const captureId = randomUUID();
  const audioPath = resolveOutputPath(captureId, args.outputPath);
  await mkdir(dirname(audioPath), { recursive: true });

  const inputDevice = args.inputDevice?.trim() || "0";
  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "avfoundation",
    "-i",
    `:${inputDevice}`,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-y",
    audioPath
  ];

  const proc = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "ignore", "pipe"]
  });

  let stderrTail = "";
  proc.stderr.on("data", (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    stderrTail = `${stderrTail}${text}`.slice(-1200);
  });

  await waitForStart(proc, 250);

  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  let stopped = false;

  return {
    capture_id: captureId,
    audio_path: audioPath,
    started_at: startedAtIso,
    async stop() {
      if (stopped) {
        const size = await stat(audioPath).then((value) => value.size).catch(() => 0);
        return {
          audio_path: audioPath,
          duration_ms: Math.max(1, Date.now() - startedAtMs),
          bytes: size
        };
      }
      stopped = true;

      try {
        proc.stdin.write("q\n");
      } catch {
        proc.kill("SIGINT");
      }

      const code = await waitForExit(proc, 5000);
      if (code === null) proc.kill("SIGKILL");

      const size = await stat(audioPath).then((value) => value.size).catch(() => 0);
      const durationMs = Math.max(1, Date.now() - startedAtMs);
      if (size <= 64) {
        throw new Error(
          `capture_failed: audio file is empty (code=${code ?? "timeout"}; stderr=${stderrTail.trim() || "none"})`
        );
      }

      return {
        audio_path: audioPath,
        duration_ms: durationMs,
        bytes: size
      };
    }
  };
}
