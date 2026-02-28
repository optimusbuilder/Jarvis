const AGENT_BASE_URL = "http://127.0.0.1:8765";

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (!msg || msg.type !== "AURA_SNAPSHOT") return;

  const payload = msg.snapshot;
  void fetch(`${AGENT_BASE_URL}/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => {
    // Agent may not be running; keep silent for MVP.
  });
});

