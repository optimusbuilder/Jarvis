import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getFrontmostAppName(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to get name of first application process whose frontmost is true'
    ]);
    const name = stdout.trim();
    return name.length ? name : null;
  } catch {
    return null;
  }
}

export async function openApp(name: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("open_app is only implemented for macOS in v1");
  }
  await execFileAsync("open", ["-a", name]);
}

export async function openPath(path: string): Promise<void> {
  await execFileAsync("open", [expandUserPath(path)]);
}

export async function openUrl(url: string): Promise<void> {
  await execFileAsync("open", [url]);
}

function expandUserPath(input: string): string {
  if (input === "~") return process.env.HOME ?? input;
  if (input.startsWith("~/")) {
    const home = process.env.HOME;
    if (!home) return input;
    return `${home}/${input.slice(2)}`;
  }
  return input;
}
