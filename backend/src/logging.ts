import { randomUUID } from "node:crypto";

export type RequestLike = {
  header(name: string): string | undefined;
  method?: string;
  path?: string;
};

export type ResponseLike = {
  setHeader(name: string, value: string): void;
};

export function ensureRequestId(req: RequestLike, res: ResponseLike): string {
  const incoming = req.header("x-request-id");
  const requestId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
  res.setHeader("x-request-id", requestId);
  return requestId;
}

export function logInfo(event: string, fields: Record<string, unknown>): void {
  const payload = {
    severity: "INFO",
    ts: new Date().toISOString(),
    event,
    ...fields
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

export function logError(event: string, fields: Record<string, unknown>): void {
  const payload = {
    severity: "ERROR",
    ts: new Date().toISOString(),
    event,
    ...fields
  };
  // eslint-disable-next-line no-console
  console.error(JSON.stringify(payload));
}
