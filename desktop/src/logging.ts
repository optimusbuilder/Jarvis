import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Env } from "./env.js";

type RequestLike = {
  header(name: string): string | undefined;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
};

function serializeRedacted(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  if (Array.isArray(value)) return value.map((item) => serializeRedacted(item));
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(input)) {
      const lower = key.toLowerCase();
      if (
        lower.includes("token") ||
        lower.includes("secret") ||
        lower.includes("password") ||
        lower.includes("authorization") ||
        lower.includes("api_key")
      ) {
        output[key] = "[REDACTED]";
        continue;
      }
      output[key] = serializeRedacted(raw);
    }
    return output;
  }
  return value;
}

export function ensureRequestId(req: RequestLike, res: ResponseLike): string {
  const incoming = req.header("x-request-id");
  const requestId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
  res.setHeader("x-request-id", requestId);
  return requestId;
}

export async function appendAuditLog(args: {
  env: Env;
  event: string;
  request_id: string;
  data: Record<string, unknown>;
}): Promise<void> {
  const targetPath = resolve(process.cwd(), args.env.AURA_AUDIT_LOG_PATH);
  await mkdir(dirname(targetPath), { recursive: true });
  const entry = {
    ts: new Date().toISOString(),
    event: args.event,
    request_id: args.request_id,
    data: serializeRedacted(args.data)
  };
  await appendFile(targetPath, `${JSON.stringify(entry)}\n`, "utf8");
}
