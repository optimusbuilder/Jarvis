import type { RequestHandler } from "express";
import type { Env } from "./env.js";

function getBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const [scheme, token] = value.split(" ", 2);
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  if (!token) return null;
  return token.trim();
}

export function requireAuth(env: Env): RequestHandler {
  return (req, res, next) => {
    if (!env.AURA_BACKEND_AUTH_TOKEN) return next();
    const token = getBearerToken(req.header("authorization"));
    if (!token || token !== env.AURA_BACKEND_AUTH_TOKEN) {
      return res.status(401).json({ error: "unauthorized" });
    }
    return next();
  };
}

