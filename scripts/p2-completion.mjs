#!/usr/bin/env node

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

function ensureToolResult(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (typeof payload.success !== "boolean") return false;
  if (typeof payload.observed_state !== "string" || !payload.observed_state.length) return false;
  if (!(typeof payload.error === "string" || payload.error === null)) return false;
  return true;
}

async function run() {
  const base = agentUrl();
  console.log(`Using desktop agent URL: ${base}`);

  const statusRes = await fetch(`${base}/status`);
  if (!statusRes.ok) fail(`GET /status failed: ${statusRes.status}`);
  const status = await statusRes.json();
  if (status?.ok !== true) fail("GET /status missing ok=true");
  ok(`GET /status (${statusRes.status})`);

  const toolsRes = await fetch(`${base}/tools`);
  if (!toolsRes.ok) fail(`GET /tools failed: ${toolsRes.status}`);
  const tools = await toolsRes.json();
  if (!Array.isArray(tools?.tools)) fail("GET /tools missing tools array");
  if (!tools.tools.includes("open_app")) fail("GET /tools missing open_app");
  ok(`GET /tools (${toolsRes.status})`);

  const unknownRes = await fetch(`${base}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "p2-c-unknown" },
    body: JSON.stringify({
      dry_run: true,
      plan: { goal: "unknown", questions: [], tool_calls: [{ name: "rm_rf", args: {} }] }
    })
  });
  if (!unknownRes.ok) fail(`POST /execute (unknown tool) failed: ${unknownRes.status}`);
  const unknown = await unknownRes.json();
  const unknownResult = unknown?.results?.[0]?.result;
  if (!ensureToolResult(unknownResult)) fail("Unknown-tool result shape invalid");
  if (unknownResult.error !== "tool_not_allowed") fail("Unknown tool was not blocked");
  ok("POST /execute blocks unknown tool");

  const safeRes = await fetch(`${base}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "p2-c-safe" },
    body: JSON.stringify({
      dry_run: true,
      plan: {
        goal: "open chrome dry run",
        questions: [],
        tool_calls: [{ name: "open_app", args: { name: "Google Chrome" } }]
      }
    })
  });
  if (!safeRes.ok) fail(`POST /execute (safe tool) failed: ${safeRes.status}`);
  const safe = await safeRes.json();
  const safeResult = safe?.results?.[0]?.result;
  if (!ensureToolResult(safeResult)) fail("Safe-tool result shape invalid");
  if (safeResult.success !== true) fail("Safe dry-run tool did not succeed");
  if (!String(safeResult.observed_state).includes("dry_run")) fail("Safe dry-run missing dry_run observed_state");
  ok("POST /execute accepts known safe dry-run tool");

  console.log("Phase 2 completion test (P2-C) passed.");
}

run().catch((err) => fail(String(err)));
