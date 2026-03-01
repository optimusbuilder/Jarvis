#!/usr/bin/env node

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

function agentUrl() {
  return (process.env.AURA_AGENT_URL ?? "http://127.0.0.1:8765").trim().replace(/\/+$/, "");
}

function hasSensitiveText(input) {
  return /\b\d{3}-\d{2}-\d{4}\b/.test(input) || /\b(?:\d[ -]*?){13,19}\b/.test(input);
}

function isSensitiveLabel(label) {
  return /\b(password|credit card|debit card|card number|cvv|cvc|ssn|social security)\b/i.test(
    label ?? ""
  );
}

async function fetchSnapshot(base) {
  const res = await fetch(`${base}/snapshot`);
  if (!res.ok) throw new Error(`GET /snapshot failed: ${res.status}`);
  return res.json();
}

async function waitForSnapshot(base, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await fetchSnapshot(base);
    if (payload?.snapshot && typeof payload.snapshot === "object") {
      return payload.snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

async function run() {
  const base = agentUrl();
  console.log(`Using desktop agent URL: ${base}`);
  console.log("Waiting for extension snapshot...");
  console.log(
    "If this times out, open extension fixture in Chrome: extension/test/fixtures/p3-fixture.html"
  );

  const snapshot = await waitForSnapshot(base);
  if (!snapshot) fail("No snapshot received from extension within timeout");

  if (!Array.isArray(snapshot.visible_text_chunks)) fail("snapshot.visible_text_chunks missing");
  if (!Array.isArray(snapshot.form_fields)) fail("snapshot.form_fields missing");
  if (!Array.isArray(snapshot.user_actions)) fail("snapshot.user_actions missing");

  const visibleSensitive = snapshot.visible_text_chunks.some(
    (chunk) => typeof chunk?.text === "string" && hasSensitiveText(chunk.text)
  );
  if (visibleSensitive) fail("Sensitive text leaked into visible_text_chunks");

  const sensitiveFields = snapshot.form_fields.filter((field) =>
    isSensitiveLabel(field?.label ?? "")
  );
  if (sensitiveFields.length > 0) fail("Sensitive form fields leaked into form_fields");

  if (snapshot.active_element && isSensitiveLabel(snapshot.active_element.label)) {
    fail("Sensitive active element leaked into snapshot.active_element");
  }

  ok("Snapshot schema present and redaction checks passed");
  console.log("Phase 3 completion test (P3-C) passed.");
}

run().catch((err) => fail(String(err)));
