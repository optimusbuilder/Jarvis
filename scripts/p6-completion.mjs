#!/usr/bin/env node

import http from "node:http";

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
    return `
      <html><body>
        <h1>Result One</h1>
        <p>This is the first result.</p>
      </body></html>
    `;
  }
  if (pathname === "/result/2") {
    return `
      <html><body>
        <h1>Result Two</h1>
        <p>Phase 6 deterministic browser flow marker.</p>
      </body></html>
    `;
  }

  const q = query.get("q") ?? "";
  if (!q) {
    return `
      <html><body>
        <h1>Fixture Search</h1>
        <p>Use q query param for results.</p>
      </body></html>
    `;
  }

  return `
    <html><body>
      <h1>Search Results for ${q}</h1>
      <ol>
        <li><a href="/result/1">Result one</a></li>
        <li><a href="/result/2">Result two</a></li>
      </ol>
    </body></html>
  `;
}

async function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const html = fixtureHtml(url.pathname, url.searchParams);
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
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

function ensureToolResult(item, index) {
  if (!item || typeof item !== "object") fail(`result[${index}] invalid`);
  if (!item.result || typeof item.result !== "object") fail(`result[${index}].result invalid`);
  if (item.result.success !== true) {
    fail(`tool ${item.normalized_tool} failed: ${JSON.stringify(item.result)}`);
  }
  if (typeof item.result.observed_state !== "string" || !item.result.observed_state.length) {
    fail(`result[${index}].observed_state missing`);
  }
}

async function run() {
  const base = agentUrl();
  console.log(`Using desktop agent URL: ${base}`);
  const fixture = await startFixtureServer();
  console.log(`Fixture server URL: ${fixture.baseUrl}`);

  try {
    const res = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": `p6-c-${Date.now()}` },
      body: JSON.stringify({
        dry_run: false,
        plan: {
          goal: "Run deterministic browser flow against local fixture",
          questions: [],
          tool_calls: [
            { name: "browser_new_tab", args: {} },
            { name: "browser_go", args: { url: `${fixture.baseUrl}/search` } },
            { name: "browser_search", args: { query: "auratest" } },
            { name: "browser_click_result", args: { index: 2 } },
            { name: "browser_extract_text", args: {} }
          ]
        }
      })
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) fail(`POST /execute failed: ${res.status} ${JSON.stringify(payload).slice(0, 220)}`);
    if (!Array.isArray(payload.results) || payload.results.length < 5) {
      fail("missing tool execution results");
    }
    payload.results.forEach((item, index) => ensureToolResult(item, index));

    const clickObserved = String(payload.results[3]?.result?.observed_state ?? "");
    if (!clickObserved.includes("/result/2")) {
      fail(`browser_click_result did not navigate to result/2: ${clickObserved}`);
    }
    const extractObserved = String(payload.results[4]?.result?.observed_state ?? "");
    if (!extractObserved.includes("extract_text_ok")) {
      fail(`browser_extract_text verification missing: ${extractObserved}`);
    }

    ok("deterministic browser fixture flow succeeded");
    console.log("Phase 6 completion test (P6-C) passed.");
  } finally {
    await fixture.close();
  }
}

run().catch((error) => fail(String(error)));
