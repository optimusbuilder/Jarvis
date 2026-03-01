#!/usr/bin/env node

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

function agentUrl() {
  const value = (process.env.AURA_AGENT_URL ?? "http://127.0.0.1:8765").trim();
  return value.replace(/\/+$/, "");
}

function fixtureHtml(pathname, query) {
  if (pathname === "/result/1") {
    return `<html><body><h1>Phase7 Result One</h1><p>result one</p></body></html>`;
  }
  if (pathname === "/result/2") {
    return `<html><body><h1>Phase7 Result Two</h1><p>integration marker</p></body></html>`;
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

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function ensureToolSuccess(item, index) {
  if (!item || typeof item !== "object") fail(`results[${index}] missing`);
  if (!item.result || typeof item.result !== "object") fail(`results[${index}].result missing`);
  if (item.result.success !== true) fail(`results[${index}] failed: ${JSON.stringify(item).slice(0, 240)}`);
}

async function run() {
  const base = agentUrl();
  console.log(`Using desktop agent URL: ${base}`);
  const fixture = await startFixtureServer();
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "aura-p7-ir-"));
  const folderName = `phase7-note-${Date.now()}`;
  const folderPath = path.join(sandbox, folderName);

  try {
    const executeRes = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": `p7-ir-${Date.now()}` },
      body: JSON.stringify({
        dry_run: false,
        plan: {
          goal: "Run mixed browser and system workflow",
          questions: [],
          tool_calls: [
            { name: "browser_new_tab", args: {} },
            { name: "browser_go", args: { url: `${fixture.baseUrl}/search` } },
            { name: "browser_search", args: { query: "phase7" } },
            { name: "browser_click_result", args: { index: 2 } },
            { name: "browser_extract_text", args: {} },
            { name: "create_folder", args: { path: folderPath } },
            { name: "search_files", args: { query: folderName, limit: 5 } }
          ]
        }
      })
    });
    const payload = await executeRes.json().catch(() => ({}));
    if (!executeRes.ok) fail(`POST /execute failed: ${executeRes.status} ${JSON.stringify(payload).slice(0, 220)}`);
    if (!Array.isArray(payload.results) || payload.results.length < 7) fail("missing mixed workflow results");
    payload.results.forEach((item, index) => ensureToolSuccess(item, index));

    const extractObserved = String(payload.results[4]?.result?.observed_state ?? "");
    if (!extractObserved.includes("extract_text_ok")) {
      fail(`browser_extract_text verification missing: ${extractObserved}`);
    }
    if (!(await pathExists(folderPath))) {
      fail(`create_folder verification failed: ${folderPath}`);
    }
    const searchObserved = String(payload.results[6]?.result?.observed_state ?? "");
    if (!searchObserved.includes("matches=")) {
      fail(`search_files verification missing: ${searchObserved}`);
    }

    ok("mixed browser + system workflow succeeded");

    const snapshotRes = await fetch(`${base}/snapshot`);
    if (!snapshotRes.ok) fail(`GET /snapshot failed: ${snapshotRes.status}`);
    ok("snapshot endpoint still healthy");

    console.log("Phase 7 integration test (P7-IR) passed.");
  } finally {
    await fixture.close();
    await rm(sandbox, { recursive: true, force: true });
  }
}

run().catch((error) => fail(String(error)));
