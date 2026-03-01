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

function validateRunPayload(payload) {
  if (!payload || typeof payload !== "object") return "response is not object";
  if (payload.ok !== true) return "ok must be true";
  if (typeof payload.request_id !== "string" || !payload.request_id.length) return "missing request_id";
  if (!payload.plan || typeof payload.plan !== "object") return "missing plan";
  if (typeof payload.plan.goal !== "string" || !payload.plan.goal.length) return "plan.goal invalid";
  if (!Array.isArray(payload.plan.tool_calls)) return "plan.tool_calls invalid";
  if (!Array.isArray(payload.results)) return "results invalid";
  for (const [index, item] of payload.results.entries()) {
    if (!item || typeof item !== "object") return `results[${index}] invalid`;
    if (typeof item.requested_tool !== "string") return `results[${index}].requested_tool invalid`;
    if (typeof item.normalized_tool !== "string") return `results[${index}].normalized_tool invalid`;
    if (!item.result || typeof item.result !== "object") return `results[${index}].result invalid`;
  }
  return null;
}

async function run() {
  const base = agentUrl();
  const requestId = `p2-ir-${Date.now()}`;
  console.log(`Using desktop agent URL: ${base}`);

  const runRes = await fetch(`${base}/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    },
    body: JSON.stringify({
      instruction: "Open Chrome",
      dry_run: true
    })
  });

  if (!runRes.ok) {
    const text = await runRes.text().catch(() => "");
    fail(`POST /run failed: ${runRes.status} ${text}`);
  }

  const payload = await runRes.json();
  const invalid = validateRunPayload(payload);
  if (invalid) fail(`POST /run response invalid: ${invalid}`);
  if (payload.request_id !== requestId) fail("request_id was not preserved");
  ok(`POST /run (${runRes.status})`);

  if (payload.backend_request_id) {
    ok(`backend_request_id captured: ${payload.backend_request_id}`);
  } else {
    console.warn("⚠️  backend_request_id missing; backend may not be propagating x-request-id");
  }

  console.log("Phase 2 integration test (P2-IR) passed.");
}

run().catch((err) => fail(String(err)));
