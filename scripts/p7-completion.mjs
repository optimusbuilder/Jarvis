#!/usr/bin/env node

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

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function ensureSuccess(result, label) {
  if (!result || typeof result !== "object") fail(`${label}: missing result object`);
  if (result.success !== true) fail(`${label}: ${JSON.stringify(result).slice(0, 240)}`);
  if (typeof result.observed_state !== "string" || !result.observed_state.length) {
    fail(`${label}: observed_state missing`);
  }
}

async function run() {
  const base = agentUrl();
  console.log(`Using desktop agent URL: ${base}`);

  const sandbox = await mkdtemp(path.join(os.tmpdir(), "aura-p7-c-"));
  const sourceDir = path.join(sandbox, "source");
  const destinationDir = path.join(sandbox, "destination");
  const originalFile = path.join(sourceDir, "phase7-source.txt");
  const renamedName = "phase7-renamed.txt";
  const renamedPath = path.join(sourceDir, renamedName);
  const movedPath = path.join(destinationDir, renamedName);

  try {
    const setup = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": `p7-c-setup-${Date.now()}` },
      body: JSON.stringify({
        dry_run: false,
        plan: {
          goal: "Create sandbox folders",
          questions: [],
          tool_calls: [
            { name: "create_folder", args: { path: sourceDir } },
            { name: "create_folder", args: { path: destinationDir } }
          ]
        }
      })
    });
    const setupPayload = await setup.json().catch(() => ({}));
    if (!setup.ok) fail(`setup failed: ${setup.status} ${JSON.stringify(setupPayload).slice(0, 220)}`);
    ensureSuccess(setupPayload?.results?.[0]?.result, "create_folder source");
    ensureSuccess(setupPayload?.results?.[1]?.result, "create_folder destination");
    ok("create_folder tools succeeded");

    await writeFile(originalFile, "Phase 7 completion test file");

    const renameMoveSearch = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": `p7-c-rms-${Date.now()}` },
      body: JSON.stringify({
        dry_run: false,
        plan: {
          goal: "Rename move and search file",
          questions: [],
          tool_calls: [
            { name: "rename_path", args: { path: originalFile, new_name: renamedName } },
            { name: "move_path", args: { path: renamedPath, destination_dir: destinationDir } },
            { name: "search_files", args: { query: "phase7-renamed", limit: 5 } }
          ]
        }
      })
    });
    const rmsPayload = await renameMoveSearch.json().catch(() => ({}));
    if (!renameMoveSearch.ok) {
      fail(`rename/move/search failed: ${renameMoveSearch.status} ${JSON.stringify(rmsPayload).slice(0, 220)}`);
    }
    ensureSuccess(rmsPayload?.results?.[0]?.result, "rename_path");
    ensureSuccess(rmsPayload?.results?.[1]?.result, "move_path");
    ensureSuccess(rmsPayload?.results?.[2]?.result, "search_files");
    if (!String(rmsPayload?.results?.[2]?.result?.observed_state ?? "").includes("matches=")) {
      fail("search_files observed_state missing matches count");
    }
    if (!(await pathExists(movedPath))) fail(`move_path verification failed; file missing at ${movedPath}`);
    ok("rename_path + move_path + search_files succeeded");

    const blockedTrash = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": `p7-c-trash-blocked-${Date.now()}` },
      body: JSON.stringify({
        dry_run: false,
        plan: {
          goal: "Attempt trash without confirmation",
          questions: [],
          tool_calls: [{ name: "trash_path", args: { path: movedPath } }]
        }
      })
    });
    const blockedPayload = await blockedTrash.json().catch(() => ({}));
    if (!blockedTrash.ok) fail(`blocked trash request failed: ${blockedTrash.status}`);
    const blockedResult = blockedPayload?.results?.[0]?.result;
    if (!blockedResult || blockedResult.error !== "confirmation_required") {
      fail(`trash_path should require confirmation: ${JSON.stringify(blockedResult).slice(0, 220)}`);
    }
    ok("trash_path blocked without confirm_action");

    const confirmedTrash = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": `p7-c-trash-confirmed-${Date.now()}` },
      body: JSON.stringify({
        dry_run: false,
        plan: {
          goal: "Confirm destructive action then trash",
          questions: [],
          tool_calls: [
            { name: "confirm_action", args: { reason: "Remove temp file for phase 7 completion test" } },
            { name: "trash_path", args: { path: movedPath } }
          ]
        }
      })
    });
    const confirmedPayload = await confirmedTrash.json().catch(() => ({}));
    if (!confirmedTrash.ok) {
      fail(`confirmed trash request failed: ${confirmedTrash.status} ${JSON.stringify(confirmedPayload).slice(0, 220)}`);
    }
    ensureSuccess(confirmedPayload?.results?.[0]?.result, "confirm_action");
    ensureSuccess(confirmedPayload?.results?.[1]?.result, "trash_path");
    if (await pathExists(movedPath)) fail("trash_path verification failed; file still exists at original location");
    ok("confirm_action + trash_path succeeded");

    console.log("Phase 7 completion test (P7-C) passed.");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

run().catch((error) => fail(String(error)));
