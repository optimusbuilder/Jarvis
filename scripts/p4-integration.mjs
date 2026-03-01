#!/usr/bin/env node

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

function agentUrl() {
  const value = (process.env.AURA_AGENT_URL ?? "http://127.0.0.1:8765").trim();
  return value.replace(/\/+$/, "");
}

function isValidToolResult(item) {
  if (!item || typeof item !== "object") return false;
  if (!item.result || typeof item.result !== "object") return false;
  if (typeof item.requested_tool !== "string") return false;
  if (typeof item.normalized_tool !== "string") return false;
  if (typeof item.result.success !== "boolean") return false;
  if (typeof item.result.observed_state !== "string") return false;
  if (!(typeof item.result.error === "string" || item.result.error === null)) return false;
  return true;
}

async function run() {
  const base = agentUrl();
  const requestId = `p4-ir-${Date.now()}`;
  const audioPath = path.resolve(repoRoot, "speech.mp3");
  console.log(`Using desktop agent URL: ${base}`);

  const res = await fetch(`${base}/voice/run`, {
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

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    fail(`POST /voice/run failed: ${res.status} ${JSON.stringify(payload).slice(0, 220)}`);
  }

  if (payload.ok !== true) fail("response missing ok=true");
  if (payload.request_id !== requestId) fail("request_id was not preserved");
  if (payload.needs_repeat !== false) fail(`expected needs_repeat=false, got ${JSON.stringify(payload.needs_repeat)}`);
  if (typeof payload.transcript !== "string" || !payload.transcript.trim()) fail("transcript missing");
  if (!payload.plan || typeof payload.plan !== "object") fail("plan missing");
  if (!Array.isArray(payload.plan.tool_calls)) fail("plan.tool_calls missing");
  if (!Array.isArray(payload.results)) fail("results missing");
  for (const [index, item] of payload.results.entries()) {
    if (!isValidToolResult(item)) fail(`results[${index}] has invalid shape`);
    if (!String(item.result.observed_state).includes("dry_run")) {
      fail(`results[${index}] was not dry_run safe`);
    }
  }

  ok(`POST /voice/run (${res.status})`);
  if (payload.backend_request_id) {
    ok(`backend_request_id captured: ${payload.backend_request_id}`);
  } else {
    console.warn("⚠️  backend_request_id missing; backend may not be propagating x-request-id");
  }
  console.log("Phase 4 integration test (P4-IR) passed.");
}

run().catch((error) => fail(String(error)));
