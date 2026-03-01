#!/usr/bin/env node

import { stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

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

function agentUrl() {
  const value = (process.env.AURA_AGENT_URL ?? "http://127.0.0.1:8765").trim();
  return value.replace(/\/+$/, "");
}

function shortResponseText(goal) {
  const base = typeof goal === "string" && goal.trim() ? goal.trim() : "completed the request";
  return `Acknowledged. I ${base}.`;
}

async function run() {
  loadLocalDotenv();
  const base = agentUrl();
  const requestId = `p5-ir-${Date.now()}`;
  const audioPath = path.resolve(repoRoot, "speech.mp3");
  console.log(`Using desktop agent URL: ${base}`);

  const voiceRunRes = await fetch(`${base}/voice/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    },
    body: JSON.stringify({
      audio_path: audioPath,
      language: "en",
      dry_run: true
    })
  });
  const voiceRun = await voiceRunRes.json().catch(() => ({}));
  if (!voiceRunRes.ok) {
    fail(`POST /voice/run failed: ${voiceRunRes.status} ${JSON.stringify(voiceRun).slice(0, 220)}`);
  }
  if (voiceRun.needs_repeat !== false) {
    fail(`voice/run requested repeat unexpectedly: ${JSON.stringify(voiceRun.reason)}`);
  }
  ok(`POST /voice/run (${voiceRunRes.status})`);

  const respondRes = await fetch(`${base}/voice/respond`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": `${requestId}-tts`
    },
    body: JSON.stringify({
      text: shortResponseText(voiceRun?.plan?.goal),
      speak: false
    })
  });
  const respond = await respondRes.json().catch(() => ({}));
  if (!respondRes.ok) {
    fail(`POST /voice/respond failed: ${respondRes.status} ${JSON.stringify(respond).slice(0, 220)}`);
  }
  if (respond.ok !== true) fail("voice/respond missing ok=true");
  if (typeof respond.audio_path !== "string" || !respond.audio_path.trim()) {
    fail("voice/respond missing audio_path");
  }
  if (typeof respond.audio_bytes !== "number" || respond.audio_bytes <= 64) {
    fail(`voice/respond audio payload too small: ${JSON.stringify(respond.audio_bytes)}`);
  }
  if (typeof respond.content_type !== "string" || !respond.content_type.toLowerCase().startsWith("audio/")) {
    fail(`voice/respond unexpected content_type: ${JSON.stringify(respond.content_type)}`);
  }
  await stat(respond.audio_path).catch(() => fail(`Audio file not found on disk: ${respond.audio_path}`));
  ok("POST /voice/respond returned playable audio artifact");

  if (voiceRun.backend_request_id) {
    ok(`backend_request_id captured from /voice/run: ${voiceRun.backend_request_id}`);
  } else {
    console.warn("⚠️  backend_request_id missing from /voice/run");
  }

  console.log("Phase 5 integration test (P5-IR) passed.");
}

run().catch((error) => fail(String(error)));
