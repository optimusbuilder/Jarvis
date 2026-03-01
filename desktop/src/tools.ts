import { z } from "zod";
import { openApp, openPath, openUrl, getFrontmostAppName } from "./macos.js";
import type { ToolCall, ToolResult } from "./schemas.js";

type ToolHandler = (args: Record<string, unknown>, opts: { dryRun: boolean }) => Promise<ToolResult>;

export type ToolSchemaDescriptor = {
  description: string;
  args_schema: Record<string, unknown>;
};

export type ExecutedToolResult = {
  requested_tool: string;
  normalized_tool: string;
  result: ToolResult;
};

function ok(observed_state: string): ToolResult {
  return { success: true, observed_state, error: null };
}

function fail(args: { observedState: string; error: unknown }): ToolResult {
  return {
    success: false,
    observed_state: args.observedState,
    error: String(args.error ?? "error")
  };
}

function withVerifiedObservedState(toolName: string, result: ToolResult): ToolResult {
  const observed = (result.observed_state ?? "").trim();
  if (observed.length > 0) return result;
  return fail({
    observedState: `verification_failed: missing observed_state for ${toolName}`,
    error: "missing_observed_state"
  });
}

const openAppArgs = z.object({ name: z.string().min(1) });
const openPathArgs = z.object({ path: z.string().min(1) });
const openUrlArgs = z.object({ url: z.string().url() });

export const toolSchemas: Record<string, ToolSchemaDescriptor> = {
  open_app: {
    description: "Open a macOS application by name.",
    args_schema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", minLength: 1 } }
    }
  },
  open_path: {
    description: "Open a file or folder path.",
    args_schema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string", minLength: 1 } }
    }
  },
  open_url: {
    description: "Open a URL in the default browser.",
    args_schema: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string", format: "uri" } }
    }
  }
};

const toolNameAliases: Record<string, string> = {
  open_application: "open_app",
  launch_app: "open_app",
  open_folder: "open_path",
  open_file: "open_path",
  navigate_url: "open_url",
  open_website: "open_url",
  browser_go: "open_url"
};

function normalizeToolCall(call: ToolCall): ToolCall {
  const mappedName = toolNameAliases[call.name] ?? call.name;
  const args = { ...(call.args ?? {}) };

  if (mappedName === "open_app") {
    const alias = typeof args.app_name === "string" ? args.app_name : undefined;
    if (alias && !args.name) args.name = alias;
  }

  if (mappedName === "open_path") {
    const alias =
      (typeof args.folder_path === "string" && args.folder_path) ||
      (typeof args.file_path === "string" && args.file_path) ||
      (typeof args.target_path === "string" && args.target_path);
    if (alias && !args.path) args.path = alias;
  }

  if (mappedName === "open_url") {
    const alias =
      (typeof args.website === "string" && args.website) ||
      (typeof args.target_url === "string" && args.target_url);
    if (alias && !args.url) args.url = alias;
  }

  return { name: mappedName, args };
}

export const toolRegistry: Record<string, ToolHandler> = {
  async open_app(args, opts) {
    const parsed = openAppArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for open_app",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would open app '${parsed.data.name}'`);
    await openApp(parsed.data.name);
    const front = await getFrontmostAppName();
    return ok(`opened app '${parsed.data.name}'; frontmost=${front ?? "unknown"}`);
  },

  async open_path(args, opts) {
    const parsed = openPathArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for open_path",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would open path '${parsed.data.path}'`);
    await openPath(parsed.data.path);
    return ok(`opened path '${parsed.data.path}'`);
  },

  async open_url(args, opts) {
    const parsed = openUrlArgs.safeParse(args);
    if (!parsed.success) {
      return fail({
        observedState: "validation_failed: invalid_args for open_url",
        error: "invalid_args"
      });
    }
    if (opts.dryRun) return ok(`dry_run: would open url '${parsed.data.url}'`);
    await openUrl(parsed.data.url);
    return ok(`opened url '${parsed.data.url}'`);
  }
};

export const allowedToolNames = Object.keys(toolRegistry).sort();

export async function executeToolCall(args: {
  call: ToolCall;
  dryRun: boolean;
}): Promise<ExecutedToolResult> {
  const normalized = normalizeToolCall(args.call);
  const handler = toolRegistry[normalized.name];
  if (!handler) {
    return {
      requested_tool: args.call.name,
      normalized_tool: normalized.name,
      result: fail({
        observedState: `blocked: tool '${normalized.name}' is not allowlisted`,
        error: "tool_not_allowed"
      })
    };
  }

  try {
    const raw = await handler(normalized.args, { dryRun: args.dryRun });
    const result = withVerifiedObservedState(normalized.name, raw);
    return {
      requested_tool: args.call.name,
      normalized_tool: normalized.name,
      result
    };
  } catch (err) {
    return {
      requested_tool: args.call.name,
      normalized_tool: normalized.name,
      result: fail({
        observedState: `execution_failed: ${normalized.name}`,
        error: String(err)
      })
    };
  }
}
