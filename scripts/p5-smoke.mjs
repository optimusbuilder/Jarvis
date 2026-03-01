#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function loadLocalDotenv() {
  const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(repoRoot, ".env")];
  const dotenvPath = candidates.find((candidate) => existsSync(candidate));
  if (!dotenvPath) return;

  const content = readFileSync(dotenvPath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const eqIndex = normalized.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = normalized.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = normalized.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) fail(`${name} is required`);
  return value.trim();
}

function optionalEnv(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

async function run() {
  loadLocalDotenv();
  const baseUrl = requiredEnv("AURA_BACKEND_URL").replace(/\/+$/, "");
  const authToken = optionalEnv("AURA_BACKEND_AUTH_TOKEN");
  const text = optionalEnv("AURA_TTS_SMOKE_TEXT") ?? "Phase five smoke test for Aura.";
  const outputPath = optionalEnv("AURA_TTS_OUTPUT_PATH");

  const headers = { "content-type": "application/json" };
  if (authToken) headers.authorization = `Bearer ${authToken}`;

  const res = await fetch(`${baseUrl}/tts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`POST /tts failed: ${res.status} ${body.slice(0, 220)}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("audio/")) {
    fail(`Unexpected content-type from /tts: ${contentType || "(missing)"}`);
  }
  const requestId = res.headers.get("x-request-id");
  if (requestId) ok(`x-request-id captured: ${requestId}`);

  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.byteLength <= 64) {
    fail(`Audio payload too small from /tts: ${audio.byteLength} bytes`);
  }
  ok(`POST /tts returned ${audio.byteLength} bytes (${contentType})`);

  if (outputPath) {
    const resolved = path.resolve(outputPath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, audio);
    ok(`Saved smoke audio to ${resolved}`);
  }

  console.log("Phase 5 completion test (P5-C) passed.");
}

run().catch((error) => fail(String(error)));
