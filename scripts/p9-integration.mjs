#!/usr/bin/env node

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) fail(`${name} is required`);
  return value.trim();
}

function authHeaders(requestId) {
  const headers = { "content-type": "application/json" };
  if (requestId) headers["x-request-id"] = requestId;
  const token = process.env.AURA_BACKEND_AUTH_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function ensureActionPlanShape(payload) {
  if (!payload || typeof payload !== "object") return "payload is not object";
  if (typeof payload.goal !== "string" || !payload.goal) return "goal missing";
  if (!Array.isArray(payload.questions)) return "questions missing";
  if (!Array.isArray(payload.tool_calls)) return "tool_calls missing";
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postPlanWithRetry(baseUrl, requestPrefix, body, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const requestId = `${requestPrefix}-${Date.now()}-${attempt}`;
    const response = await fetch(`${baseUrl}/plan`, {
      method: "POST",
      headers: authHeaders(requestId),
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      const shapeError = ensureActionPlanShape(payload);
      if (shapeError) fail(`/plan response shape invalid: ${shapeError}`);
      if (response.headers.get("x-request-id") !== requestId) {
        fail("/plan request id was not preserved");
      }
      return payload;
    }

    const isRetriablePlannerFailure =
      response.status === 502 && payload && typeof payload === "object" && payload.error === "planner_failed";
    if (isRetriablePlannerFailure && attempt < maxAttempts) {
      console.warn(`⚠️  /plan returned planner_failed (attempt ${attempt}/${maxAttempts}); retrying...`);
      await sleep(350 * attempt);
      continue;
    }

    fail(`POST /plan failed: ${response.status} ${JSON.stringify(payload).slice(0, 220)}`);
  }

  fail("POST /plan failed after retries");
}

function makeResearchSnapshot(sessionId, hesitation = 0.62) {
  return {
    session_id: sessionId,
    url: "https://example.com/research",
    domain: "example.com",
    page_type: "article",
    page_title: "Research Read",
    visible_text_chunks: Array.from({ length: 12 }, (_, i) => ({
      id: `r-${i}`,
      text: `Finding ${i + 1} for integration scenario`,
      source: "p"
    })),
    active_element: null,
    form_fields: [],
    user_actions: [{ type: "tab_switch" }, { type: "tab_switch" }, { type: "cursor_idle", ms: 4200 }],
    hesitation_score: hesitation,
    tab_cluster_topic: "phase9 regression",
    timestamp: new Date().toISOString()
  };
}

async function run() {
  const baseUrl = requireEnv("AURA_BACKEND_URL").replace(/\/+$/, "");
  console.log(`Using backend URL: ${baseUrl}`);

  await postPlanWithRetry(baseUrl, "p9-ir-plan", {
    instruction: "Open Chrome",
    desktop_state: { os: "macos", frontmost_app: "Finder" }
  });
  ok("action-mode /plan remains healthy");

  const sessionId = `p9-ir-session-${Date.now()}`;
  const initialCopilot = await fetch(`${baseUrl}/copilot`, {
    method: "POST",
    headers: authHeaders(`p9-ir-copilot-initial-${Date.now()}`),
    body: JSON.stringify({
      session_id: sessionId,
      context_snapshot: makeResearchSnapshot(sessionId)
    })
  });
  const initialPayload = await initialCopilot.json().catch(() => ({}));
  if (!initialCopilot.ok) {
    fail(`initial /copilot failed: ${initialCopilot.status} ${JSON.stringify(initialPayload).slice(0, 220)}`);
  }
  if (typeof initialPayload.intervene !== "boolean") fail("initial copilot missing intervene boolean");
  ok("copilot response validated");

  for (let i = 0; i < 2; i += 1) {
    const feedbackRes = await fetch(`${baseUrl}/copilot/feedback`, {
      method: "POST",
      headers: authHeaders(`p9-ir-feedback-${i}-${Date.now()}`),
      body: JSON.stringify({
        session_id: sessionId,
        action: "dismiss",
        suggestion_kind: "summary",
        reason: "not needed now",
        timestamp: new Date().toISOString()
      })
    });
    const feedbackPayload = await feedbackRes.json().catch(() => ({}));
    if (!feedbackRes.ok) {
      fail(`feedback ${i} failed: ${feedbackRes.status} ${JSON.stringify(feedbackPayload).slice(0, 220)}`);
    }
    if (feedbackPayload?.ok !== true) fail(`feedback ${i} missing ok=true`);
  }
  ok("copilot feedback loop validated");

  const afterFeedback = await fetch(`${baseUrl}/copilot`, {
    method: "POST",
    headers: authHeaders(`p9-ir-copilot-after-${Date.now()}`),
    body: JSON.stringify({
      session_id: sessionId,
      context_snapshot: makeResearchSnapshot(sessionId)
    })
  });
  const afterPayload = await afterFeedback.json().catch(() => ({}));
  if (!afterFeedback.ok) {
    fail(`after-feedback /copilot failed: ${afterFeedback.status} ${JSON.stringify(afterPayload).slice(0, 220)}`);
  }
  if (typeof afterPayload.intervene !== "boolean") fail("after-feedback copilot missing intervene");
  if (typeof afterPayload.reason !== "string") fail("after-feedback copilot missing reason");
  ok("copilot still returns valid schema after feedback updates");

  await postPlanWithRetry(baseUrl, "p9-ir-plan-2", {
    instruction: "Go to youtube.com",
    desktop_state: { os: "macos", frontmost_app: "Terminal" }
  });
  ok("action-mode /plan still healthy after copilot operations");

  console.log("Phase 9 integration test (P9-IR) passed.");
}

run().catch((error) => fail(String(error)));
