#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

function ensureSuccess(item, index) {
  if (!item || typeof item !== "object") fail(`results[${index}] missing`);
  if (!item.result || typeof item.result !== "object") fail(`results[${index}].result missing`);
  if (item.result.success !== true) fail(`results[${index}] failed: ${JSON.stringify(item).slice(0, 260)}`);
}

async function readClipboard() {
  const { stdout } = await execFileAsync("pbpaste");
  return String(stdout ?? "").trim();
}

async function readTextEditDocument() {
  const { stdout } = await execFileAsync("osascript", [
    "-e",
    'tell application "TextEdit"',
    "-e",
    "if (count of documents) = 0 then return \"\"",
    "-e",
    "return (text of front document as string)",
    "-e",
    "end tell"
  ]);
  return String(stdout ?? "").trim();
}

async function run() {
  const base = agentUrl();
  console.log(`Using desktop agent URL: ${base}`);

  const statusRes = await fetch(`${base}/status`);
  const statusPayload = await statusRes.json().catch(() => ({}));
  if (!statusRes.ok) fail(`GET /status failed: ${statusRes.status}`);
  if (statusPayload?.permissions?.accessibility !== true) {
    fail(
      "Accessibility permission is not enabled for your terminal/Codex process. Enable it in System Settings > Privacy & Security > Accessibility."
    );
  }
  ok("Accessibility permission is enabled");

  await fetch(`${base}/control/kill-switch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ active: false })
  });

  const phrase = `Aura phase 8 completion marker ${Date.now()}`;
  const executeRes = await fetch(`${base}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": `p8-c-${Date.now()}` },
    body: JSON.stringify({
      dry_run: false,
      plan: {
        goal: "Verify accessibility controller by typing and copying text in TextEdit",
        questions: [],
        tool_calls: [
          { name: "open_app", args: { name: "TextEdit" } },
          { name: "focus_app", args: { name: "TextEdit" } },
          { name: "wait_ms", args: { ms: 450 } },
          { name: "click_menu", args: { app_name: "TextEdit", menu_path: ["File", "New"] } },
          { name: "wait_ms", args: { ms: 180 } },
          { name: "type_text", args: { text: phrase } },
          { name: "wait_ms", args: { ms: 120 } },
          { name: "click_menu", args: { app_name: "TextEdit", menu_path: ["Edit", "Select All"] } },
          { name: "click_menu", args: { app_name: "TextEdit", menu_path: ["Edit", "Copy"] } }
        ]
      }
    })
  });
  const payload = await executeRes.json().catch(() => ({}));
  if (!executeRes.ok) fail(`POST /execute failed: ${executeRes.status} ${JSON.stringify(payload).slice(0, 220)}`);
  if (!Array.isArray(payload.results) || payload.results.length < 9) fail("missing execution results");
  payload.results.forEach((item, index) => ensureSuccess(item, index));

  const clipboard = await readClipboard().catch(() => "");
  if (clipboard.includes(phrase)) {
    ok("Accessibility action flow succeeded and clipboard verification passed");
    console.log("Phase 8 completion test (P8-C) passed.");
    return;
  }

  const textEditDoc = await readTextEditDocument().catch(() => "");
  if (!textEditDoc.includes(phrase)) {
    fail(
      `verification failed; marker not found in clipboard or TextEdit. Clipboard preview: ${clipboard.slice(0, 120)}`
    );
  }

  ok("Accessibility action flow succeeded and TextEdit document verification passed");
  console.log("Phase 8 completion test (P8-C) passed.");
}

run().catch((error) => fail(String(error)));
