const AGENT_BASE_URL = "http://127.0.0.1:8765";
const FEEDBACK_KEY = "aura_bubble_feedback_log";

async function postSnapshot(payload: unknown): Promise<void> {
  await fetch(`${AGENT_BASE_URL}/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function persistFeedback(feedback: unknown): Promise<void> {
  const existing = await chrome.storage.session.get([FEEDBACK_KEY]);
  const list = Array.isArray(existing[FEEDBACK_KEY]) ? (existing[FEEDBACK_KEY] as unknown[]) : [];
  list.push(feedback);
  const max = 50;
  const trimmed = list.length > max ? list.slice(list.length - max) : list;
  await chrome.storage.session.set({ [FEEDBACK_KEY]: trimmed });
}

async function postFeedbackToAgent(payload: unknown): Promise<void> {
  await fetch(`${AGENT_BASE_URL}/copilot/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "AURA_SNAPSHOT") {
    void postSnapshot(msg.snapshot).catch(() => {
      // Agent may not be running; keep silent in MVP.
    });
    return;
  }

  if (msg.type === "AURA_BUBBLE_FEEDBACK") {
    const feedback = msg.feedback;
    void persistFeedback(feedback).catch(() => {
      // best-effort local telemetry for UX testing.
    });
    if (feedback && typeof feedback === "object") {
      const safeFeedback = {
        session_id: (feedback as Record<string, unknown>).session_id ?? "unknown",
        action: (feedback as Record<string, unknown>).action,
        suggestion_kind: (feedback as Record<string, unknown>).kind,
        reason: (feedback as Record<string, unknown>).reason,
        response: (feedback as Record<string, unknown>).response,
        timestamp: (feedback as Record<string, unknown>).at
      };
      void postFeedbackToAgent(safeFeedback).catch(() => {
        // Agent/backed may be unavailable; keep silent in MVP.
      });
    }
  }
});
