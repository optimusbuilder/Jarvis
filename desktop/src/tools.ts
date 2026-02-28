import { z } from "zod";
import { openApp, openPath, openUrl, getFrontmostAppName } from "./macos.js";
import type { ToolResult } from "./schemas.js";

type ToolHandler = (args: Record<string, unknown>, opts: { dryRun: boolean }) => Promise<ToolResult>;

function ok(observed_state: string): ToolResult {
  return { success: true, observed_state, error: null };
}

function fail(error: unknown): ToolResult {
  return { success: false, observed_state: "", error: String(error ?? "error") };
}

const openAppArgs = z.object({ name: z.string().min(1) });
const openPathArgs = z.object({ path: z.string().min(1) });
const openUrlArgs = z.object({ url: z.string().url() });

export const toolRegistry: Record<string, ToolHandler> = {
  async open_app(args, opts) {
    const parsed = openAppArgs.safeParse(args);
    if (!parsed.success) return fail("invalid_args");
    if (opts.dryRun) return ok(`dry_run: would open app '${parsed.data.name}'`);
    await openApp(parsed.data.name);
    const front = await getFrontmostAppName();
    return ok(`opened app '${parsed.data.name}'; frontmost=${front ?? "unknown"}`);
  },

  async open_path(args, opts) {
    const parsed = openPathArgs.safeParse(args);
    if (!parsed.success) return fail("invalid_args");
    if (opts.dryRun) return ok(`dry_run: would open path '${parsed.data.path}'`);
    await openPath(parsed.data.path);
    return ok(`opened path '${parsed.data.path}'`);
  },

  async open_url(args, opts) {
    const parsed = openUrlArgs.safeParse(args);
    if (!parsed.success) return fail("invalid_args");
    if (opts.dryRun) return ok(`dry_run: would open url '${parsed.data.url}'`);
    await openUrl(parsed.data.url);
    return ok(`opened url '${parsed.data.url}'`);
  }
};

export const allowedToolNames = Object.keys(toolRegistry).sort();

