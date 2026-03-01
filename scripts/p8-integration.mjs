#!/usr/bin/env node

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function fixtureHtml(pathname, query) {
  if (pathname === "/result/1") {
    return `<html><body><h1>Phase8 Result One</h1><p>result one</p></body></html>`;
  }
  if (pathname === "/result/2") {
    return `<html><body><h1>Phase8 Result Two</h1><p>integration marker</p></body></html>`;
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

function ensureToolSuccess(item, index) {
  if (!item || typeof item !== "object") fail(`results[${index}] missing`);
  if (!item.result || typeof item.result !== "object") fail(`results[${index}].result missing`);
  if (item.result.success !== true) fail(`results[${index}] failed: ${JSON.stringify(item).slice(0, 240)}`);
}

async function setKillSwitch(base, active, reason) {
  const res = await fetch(`${base}/control/kill-switch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(active ? { active: true, reason } : { active: false })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) fail(`kill switch update failed: ${res.status} ${JSON.stringify(payload).slice(0, 220)}`);
  return payload;
}

async function run() {
  const base = agentUrl();
  console.log(`Using desktop agent URL: ${base}`);

  const fixture = await startFixtureServer();
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "aura-p8-ir-"));
  const targetFile = path.join(sandbox, "phase8-target.txt");
  const regressionFolderName = `phase8-regression-${Date.now()}`;
  const regressionFolderPath = path.join(sandbox, regressionFolderName);

  try {
    await writeFile(targetFile, "phase8");
    await setKillSwitch(base, false);

    const executePromise = fetch(`${base}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": `p8-ir-kill-${Date.now()}` },
      body: JSON.stringify({
        dry_run: false,
        plan: {
          goal: "Kill switch interruption test",
          questions: [],
          tool_calls: [
            { name: "wait_ms", args: { ms: 1800 } },
            { name: "confirm_action", args: { reason: "Trash phase8 target file" } },
            { name: "trash_path", args: { path: targetFile } }
          ]
        }
      })
    });

    await sleep(250);
    await setKillSwitch(base, true, "phase8_integration_manual_stop");

    const executeRes = await executePromise;
    const executePayload = await executeRes.json().catch(() => ({}));
    if (!executeRes.ok) {
      fail(`kill-switch execute failed: ${executeRes.status} ${JSON.stringify(executePayload).slice(0, 220)}`);
    }
    if (executePayload.aborted !== true) {
      fail(`expected aborted=true after kill switch activation: ${JSON.stringify(executePayload).slice(0, 260)}`);
    }
    if (!Array.isArray(executePayload.results) || executePayload.results.length < 2) {
      fail("kill-switch execute results missing");
    }
    if (executePayload.results[1]?.result?.error !== "kill_switch_active") {
      fail(`expected blocked second step: ${JSON.stringify(executePayload.results[1]).slice(0, 220)}`);
    }
    if (!(await pathExists(targetFile))) {
      fail("target file should still exist because kill switch blocked destructive action");
    }
    ok("Kill switch interrupts a running plan before destructive action");

    await setKillSwitch(base, false);

    const regressionRes = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": `p8-ir-regression-${Date.now()}` },
      body: JSON.stringify({
        dry_run: false,
        plan: {
          goal: "Phase7 regression after kill-switch test",
          questions: [],
          tool_calls: [
            { name: "browser_new_tab", args: {} },
            { name: "browser_go", args: { url: `${fixture.baseUrl}/search` } },
            { name: "browser_search", args: { query: "phase8" } },
            { name: "browser_click_result", args: { index: 2 } },
            { name: "browser_extract_text", args: {} },
            { name: "create_folder", args: { path: regressionFolderPath } },
            { name: "search_files", args: { query: regressionFolderName, limit: 5 } }
          ]
        }
      })
    });
    const regressionPayload = await regressionRes.json().catch(() => ({}));
    if (!regressionRes.ok) {
      fail(`regression execute failed: ${regressionRes.status} ${JSON.stringify(regressionPayload).slice(0, 220)}`);
    }
    if (!Array.isArray(regressionPayload.results) || regressionPayload.results.length < 7) {
      fail("regression results missing");
    }
    regressionPayload.results.forEach((item, index) => ensureToolSuccess(item, index));
    if (!(await pathExists(regressionFolderPath))) {
      fail("regression folder not created");
    }
    ok("Post-kill-switch browser + system regression flow passed");

    const snapshotRes = await fetch(`${base}/snapshot`);
    if (!snapshotRes.ok) fail(`GET /snapshot failed: ${snapshotRes.status}`);
    ok("snapshot endpoint still healthy");

    console.log("Phase 8 integration test (P8-IR) passed.");
  } finally {
    await setKillSwitch(base, false).catch(() => {});
    await fixture.close();
    await rm(sandbox, { recursive: true, force: true });
  }
}

run().catch((error) => fail(String(error)));
