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

function normalize(input) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requiredTokenRecall(actual, requiredTokens) {
  const tokenSet = new Set(normalize(actual).split(" ").filter(Boolean));
  const matched = requiredTokens.filter((token) => tokenSet.has(token)).length;
  return requiredTokens.length === 0 ? 1 : matched / requiredTokens.length;
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function run() {
  const base = agentUrl();
  const goodAudioPath = path.resolve(repoRoot, "speech.mp3");
  const silenceAudioPath = path.resolve(repoRoot, "desktop/test/fixtures/audio/silence-1s.wav");
  const expectedTokens = ["deployment", "successful", "aura", "officially", "online"];

  console.log(`Using desktop agent URL: ${base}`);

  const good = await postJson(`${base}/voice/transcribe`, {
    audio_path: goodAudioPath,
    language: "en"
  });
  if (good.status !== 200) {
    fail(
      `POST /voice/transcribe (good fixture) failed: ${good.status} ${JSON.stringify(good.data).slice(0, 200)}`
    );
  }
  if (good.data.quality !== "good") {
    fail(`Expected quality=good for speech fixture; got ${JSON.stringify(good.data.quality)}`);
  }
  const recall = requiredTokenRecall(good.data.transcript, expectedTokens);
  if (recall < 0.8) {
    fail(
      `Transcript mismatch for speech fixture. recall=${recall.toFixed(2)} transcript=${JSON.stringify(good.data.transcript)}`
    );
  }
  ok(`speech fixture transcribed (token recall ${recall.toFixed(2)})`);

  const low = await postJson(`${base}/voice/transcribe`, {
    audio_path: silenceAudioPath,
    language: "en"
  });
  if (low.status !== 200) {
    fail(
      `POST /voice/transcribe (low-quality fixture) failed: ${low.status} ${JSON.stringify(low.data).slice(0, 200)}`
    );
  }
  if (low.data.quality !== "repeat") {
    fail(
      `Expected quality=repeat for low-quality fixture; got ${JSON.stringify(low.data.quality)} transcript=${JSON.stringify(low.data.transcript)}`
    );
  }
  ok("low-quality fixture triggers repeat request");

  console.log("Phase 4 completion test (P4-C) passed.");
}

run().catch((error) => fail(String(error)));
