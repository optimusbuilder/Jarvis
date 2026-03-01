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

function authHeaders() {
  const headers = { "content-type": "application/json" };
  const token = process.env.AURA_BACKEND_AUTH_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function ensureCopilotShape(payload) {
  if (!payload || typeof payload !== "object") return "payload is not an object";
  if (typeof payload.intervene !== "boolean") return "intervene must be boolean";
  if (typeof payload.reason !== "string") return "reason must be string";
  if (typeof payload.response !== "string") return "response must be string";
  return null;
}

function makeSnapshot(args) {
  return {
    session_id: args.session_id,
    url: args.url,
    domain: args.domain,
    page_type: args.page_type,
    page_title: args.page_title,
    visible_text_chunks: args.visible_text_chunks,
    active_element: args.active_element ?? null,
    form_fields: args.form_fields ?? [],
    user_actions: args.user_actions ?? [],
    hesitation_score: args.hesitation_score ?? 0,
    tab_cluster_topic: args.tab_cluster_topic,
    timestamp: new Date().toISOString()
  };
}

async function callCopilot(baseUrl, snapshot) {
  const res = await fetch(`${baseUrl}/copilot`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ context_snapshot: snapshot, session_id: snapshot.session_id })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) fail(`POST /copilot failed: ${res.status} ${JSON.stringify(payload).slice(0, 220)}`);
  const shapeError = ensureCopilotShape(payload);
  if (shapeError) fail(`copilot response schema invalid: ${shapeError}`);
  return payload;
}

async function run() {
  const baseUrl = requireEnv("AURA_BACKEND_URL").replace(/\/+$/, "");
  console.log(`Using backend URL: ${baseUrl}`);

  const scenarios = [
    {
      name: "form_completion",
      snapshot: makeSnapshot({
        session_id: "p9-form",
        url: "https://example.com/apply",
        domain: "example.com",
        page_type: "form",
        page_title: "Application",
        visible_text_chunks: [
          { id: "1", text: "Describe impact achieved improved outcomes", source: "label" },
          { id: "2", text: "Use measurable results and metrics", source: "p" }
        ],
        active_element: { kind: "textarea", label: "Impact statement", value_length: 0 },
        form_fields: [
          {
            field_id: "impact",
            label: "Impact statement",
            kind: "textarea",
            required: true,
            is_sensitive: false,
            answered: false
          }
        ],
        user_actions: [{ type: "cursor_idle", ms: 6800 }, { type: "repeated_edit" }],
        hesitation_score: 0.86
      }),
      expectIntervene: true,
      expectReason: "friction",
      expectResponse: "draft"
    },
    {
      name: "research_consolidation",
      snapshot: makeSnapshot({
        session_id: "p9-research",
        url: "https://example.com/research-topic",
        domain: "example.com",
        page_type: "article",
        page_title: "Research Notes",
        visible_text_chunks: Array.from({ length: 10 }, (_, i) => ({
          id: `a-${i}`,
          text: `Research point ${i + 1} with supporting detail`,
          source: "p"
        })),
        user_actions: [
          { type: "cursor_idle", ms: 4200 },
          { type: "tab_switch" },
          { type: "tab_switch" },
          { type: "tab_switch" }
        ],
        hesitation_score: 0.66,
        tab_cluster_topic: "llm agent architecture"
      }),
      expectIntervene: true,
      expectReason: "Research",
      expectResponse: "summary"
    },
    {
      name: "writing_rewrite",
      snapshot: makeSnapshot({
        session_id: "p9-writing",
        url: "https://example.com/editor",
        domain: "example.com",
        page_type: "editor",
        page_title: "Draft",
        visible_text_chunks: [
          { id: "w1", text: "The tone shifts multiple times in this paragraph.", source: "p" },
          { id: "w2", text: "The sentence can be clearer and shorter.", source: "p" },
          { id: "w3", text: "User repeatedly edits this section.", source: "p" }
        ],
        active_element: { kind: "contenteditable", label: "Body", value_length: 280 },
        user_actions: [{ type: "repeated_edit" }, { type: "repeated_edit" }, { type: "cursor_idle", ms: 3400 }],
        hesitation_score: 0.72
      }),
      expectIntervene: true,
      expectReason: "Writing",
      expectResponse: "rewrite"
    },
    {
      name: "product_comparison",
      snapshot: makeSnapshot({
        session_id: "p9-product",
        url: "https://example.com/product-x",
        domain: "example.com",
        page_type: "product",
        page_title: "Product X",
        visible_text_chunks: [
          { id: "p1", text: "Price $49 per month", source: "p" },
          { id: "p2", text: "Competitor plan $39 with fewer features", source: "p" },
          { id: "p3", text: "Storage and support details", source: "li" }
        ],
        user_actions: [{ type: "tab_switch" }, { type: "tab_switch" }, { type: "cursor_idle", ms: 3600 }],
        hesitation_score: 0.71
      }),
      expectIntervene: true,
      expectReason: "friction",
      expectResponse: "comparison"
    },
    {
      name: "sensitive_domain_silent",
      snapshot: makeSnapshot({
        session_id: "p9-sensitive",
        url: "https://accounts.google.com/signin",
        domain: "accounts.google.com",
        page_type: "form",
        page_title: "Sign in",
        visible_text_chunks: [{ id: "s1", text: "Enter your password", source: "label" }],
        active_element: { kind: "input", label: "Password", input_type: "password", value_length: 0 },
        form_fields: [
          {
            field_id: "password",
            label: "Password",
            kind: "input",
            input_type: "password",
            required: true,
            is_sensitive: true,
            answered: false
          }
        ],
        user_actions: [{ type: "cursor_idle", ms: 2000 }],
        hesitation_score: 0.5
      }),
      expectIntervene: false,
      expectReason: "Sensitive domain",
      expectResponse: ""
    }
  ];

  for (const scenario of scenarios) {
    const out = await callCopilot(baseUrl, scenario.snapshot);
    if (out.intervene !== scenario.expectIntervene) {
      fail(`${scenario.name}: intervene expected ${scenario.expectIntervene} got ${out.intervene}`);
    }
    if (!String(out.reason).includes(scenario.expectReason)) {
      fail(`${scenario.name}: reason missing expected marker "${scenario.expectReason}" (${out.reason})`);
    }
    if (scenario.expectResponse && !String(out.response).toLowerCase().includes(scenario.expectResponse.toLowerCase())) {
      fail(`${scenario.name}: response missing expected marker "${scenario.expectResponse}" (${out.response})`);
    }
    ok(`${scenario.name} validated`);
  }

  const feedbackRes = await fetch(`${baseUrl}/copilot/feedback`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      session_id: "p9-form",
      action: "accept",
      suggestion_kind: "form",
      reason: "Helpful",
      timestamp: new Date().toISOString()
    })
  });
  const feedback = await feedbackRes.json().catch(() => ({}));
  if (!feedbackRes.ok) fail(`POST /copilot/feedback failed: ${feedbackRes.status} ${JSON.stringify(feedback).slice(0, 220)}`);
  if (feedback?.ok !== true) fail("copilot feedback response missing ok=true");
  if (typeof feedback?.stats?.accepts !== "number") fail("copilot feedback response missing stats.accepts");
  ok("copilot feedback route validated");

  console.log("Phase 9 completion test (P9-C) passed.");
}

run().catch((error) => fail(String(error)));
