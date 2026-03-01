#!/usr/bin/env node

import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

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

function fixtureHtml(pathname, query) {
  if (pathname === "/result/1") {
    return `<html><body><h1>Result One</h1><p>Integration result one.</p></body></html>`;
  }
  if (pathname === "/result/2") {
    return `<html><body><h1>Result Two</h1><p>Integration result two marker.</p></body></html>`;
  }
  const q = query.get("q") ?? "";
  return `<html><body><h1>Search ${q}</h1><a href="/result/1">One</a><a href="/result/2">Two</a></body></html>`;
}

async function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(fixtureHtml(url.pathname, url.searchParams));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture_server_failed");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      })
  };
}

async function runVoice(base) {
  const audioPath = path.resolve(repoRoot, "speech.mp3");
  await stat(audioPath).catch(() => fail(`missing fixture audio: ${audioPath}`));
  const requestId = `p6-ir-voice-${Date.now()}`;
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
  if (!res.ok) fail(`POST /voice/run failed: ${res.status} ${JSON.stringify(payload).slice(0, 220)}`);
  if (payload.needs_repeat !== false) fail(`voice/run asked repeat unexpectedly: ${JSON.stringify(payload.reason)}`);
  ok("voice pipeline still works");
}

async function runBrowserFlow(base, fixtureBase) {
  const res = await fetch(`${base}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": `p6-ir-browser-${Date.now()}` },
    body: JSON.stringify({
      dry_run: false,
      plan: {
        goal: "phase6 integration browser flow",
        questions: [],
        tool_calls: [
          { name: "browser_new_tab", args: {} },
          { name: "browser_go", args: { url: `${fixtureBase}/search` } },
          { name: "browser_search", args: { query: "integration" } },
          { name: "browser_click_result", args: { index: 2 } },
          { name: "browser_extract_text", args: {} }
        ]
      }
    })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) fail(`POST /execute browser flow failed: ${res.status} ${JSON.stringify(payload).slice(0, 220)}`);
  if (!Array.isArray(payload.results)) fail("browser integration results missing");
  for (const item of payload.results) {
    if (item?.result?.success !== true) fail(`browser tool failed: ${JSON.stringify(item)}`);
  }
  ok("browser deterministic flow still works");
}

async function run() {
  const base = agentUrl();
  console.log(`Using desktop agent URL: ${base}`);
  const fixture = await startFixtureServer();
  try {
    await runVoice(base);
    await runBrowserFlow(base, fixture.baseUrl);

    const snapshotRes = await fetch(`${base}/snapshot`);
    if (!snapshotRes.ok) fail(`GET /snapshot failed: ${snapshotRes.status}`);
    ok("snapshot endpoint still healthy");

    console.log("Phase 6 integration test (P6-IR) passed.");
  } finally {
    await fixture.close();
  }
}

run().catch((error) => fail(String(error)));
