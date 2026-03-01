#!/usr/bin/env node

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

function getEnv(name, required = true) {
  const value = process.env[name];
  if (!required) return value;
  if (!value || !value.trim()) fail(`${name} is required`);
  return value;
}

function ensureActionPlanShape(payload) {
  if (!payload || typeof payload !== "object") return "response is not an object";
  if (typeof payload.goal !== "string" || payload.goal.length === 0) return "goal must be a non-empty string";
  if (!Array.isArray(payload.questions)) return "questions must be an array";
  if (!payload.questions.every((item) => typeof item === "string")) return "questions must contain strings";
  if (!Array.isArray(payload.tool_calls)) return "tool_calls must be an array";
  for (const [index, call] of payload.tool_calls.entries()) {
    if (!call || typeof call !== "object") return `tool_calls[${index}] must be an object`;
    if (typeof call.name !== "string" || !call.name) return `tool_calls[${index}].name must be a non-empty string`;
    if (!call.args || typeof call.args !== "object" || Array.isArray(call.args)) {
      return `tool_calls[${index}].args must be an object`;
    }
  }
  return null;
}

function ensureCopilotShape(payload) {
  if (!payload || typeof payload !== "object") return "response is not an object";
  if (typeof payload.intervene !== "boolean") return "intervene must be boolean";
  if (typeof payload.reason !== "string") return "reason must be string";
  if (typeof payload.response !== "string") return "response must be string";
  return null;
}

async function run() {
  const baseUrl = getEnv("AURA_BACKEND_URL").trim().replace(/\/+$/, "");
  const authToken = getEnv("AURA_BACKEND_AUTH_TOKEN", false);
  console.log(`Using backend URL: ${baseUrl}`);

  const healthRes = await fetch(`${baseUrl}/healthz`);
  if (!healthRes.ok) {
    const body = await healthRes.text().catch(() => "");
    const isGoogleHtml404 =
      healthRes.status === 404 &&
      /<title>Error 404 \(Not Found\)!!1<\/title>/i.test(body) &&
      /That’s an error\./i.test(body);
    if (isGoogleHtml404) {
      console.warn(
        "⚠️  GET /healthz returned Google HTML 404. Proceeding with /plan + /copilot checks (backend is still reachable)."
      );
    } else {
      fail(`GET /healthz failed with status ${healthRes.status}. Body preview: ${body.slice(0, 200)}`);
    }
  } else {
    const health = await healthRes.json();
    if (!health || health.ok !== true) fail("GET /healthz payload missing ok=true");
    if (typeof health.version !== "string" || !health.version) fail("GET /healthz payload missing version");
    ok(`GET /healthz (${healthRes.status})`);
  }

  const headers = { "content-type": "application/json" };
  if (authToken) headers.authorization = `Bearer ${authToken}`;

  const planRes = await fetch(`${baseUrl}/plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      instruction: "Open Chrome",
      desktop_state: { os: "macos", frontmost_app: "Finder" }
    })
  });

  if (!planRes.ok) {
    const errText = await planRes.text().catch(() => "");
    fail(`POST /plan failed with status ${planRes.status}: ${errText}`);
  }

  const plan = await planRes.json();
  const shapeError = ensureActionPlanShape(plan);
  if (shapeError) fail(`POST /plan schema validation failed: ${shapeError}`);
  ok(`POST /plan (${planRes.status})`);

  const requestId = planRes.headers.get("x-request-id");
  if (requestId) {
    ok(`request_id captured: ${requestId}`);
    console.log(`   Use this in Cloud Run logs filter for proof: jsonPayload.request_id="${requestId}"`);
  } else {
    console.warn("⚠️  x-request-id header missing on /plan response");
  }

  const copilotRes = await fetch(`${baseUrl}/copilot`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  if (!copilotRes.ok) {
    const errText = await copilotRes.text().catch(() => "");
    fail(`POST /copilot failed with status ${copilotRes.status}: ${errText}`);
  }
  const copilot = await copilotRes.json();
  const copilotError = ensureCopilotShape(copilot);
  if (copilotError) fail(`POST /copilot schema validation failed: ${copilotError}`);
  ok(`POST /copilot (${copilotRes.status})`);

  console.log("Phase 1 smoke test passed.");
}

run().catch((error) => fail(String(error)));
