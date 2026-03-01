import { pickSuggestion, SuggestionBubble } from "./bubble.js";
import { buildContextSnapshot } from "./snapshot.js";
import type { UserAction } from "./types.js";

const SNAPSHOT_INTERVAL_MS = 5000;
const USER_ACTION_LIMIT = 30;

const userActions: UserAction[] = [];
const fieldEditCounts = new Map<string, number>();
let inPageSessionId: string | null = null;
let lastInteractionAtMs = Date.now();
let lastBubbleShownAtMs = 0;

function recordAction(action: UserAction): void {
  userActions.push(action);
  if (userActions.length > USER_ACTION_LIMIT) {
    userActions.splice(0, userActions.length - USER_ACTION_LIMIT);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function touch(type: string, target?: string, details?: string): void {
  lastInteractionAtMs = Date.now();
  recordAction({ type, target, details, at: nowIso() });
}

function elementKey(el: EventTarget | null): string | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.id) return `id:${el.id}`;
  const name = (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).name;
  if (name) return `name:${name}`;
  return `${el.tagName.toLowerCase()}:unknown`;
}

function trackActivity(): void {
  document.addEventListener("click", (event) => {
    touch("click", elementKey(event.target) ?? undefined);
  });

  document.addEventListener("keydown", (event) => {
    const key = event.key.length === 1 ? "character" : event.key;
    touch("keydown", elementKey(event.target) ?? undefined, key);
  });

  document.addEventListener("selectionchange", () => {
    const selection = document.getSelection()?.toString() ?? "";
    if (!selection.trim()) return;
    touch("selection", undefined, `${selection.trim().slice(0, 80)}`);
  });

  document.addEventListener("visibilitychange", () => {
    touch("visibility_change", undefined, document.visibilityState);
  });

  const onEdit = (event: Event) => {
    const key = elementKey(event.target);
    if (!key) return;
    const next = (fieldEditCounts.get(key) ?? 0) + 1;
    fieldEditCounts.set(key, next);
    touch("edit", key);
    if (next >= 3) {
      touch("repeated_edit", key, `count=${next}`);
    }
  };

  document.addEventListener("input", onEdit, true);
  document.addEventListener("change", onEdit, true);
}

function repeatedEditCount(): number {
  let max = 0;
  for (const count of fieldEditCounts.values()) {
    if (count > max) max = count;
  }
  return max;
}

function createBubble(): SuggestionBubble {
  return new SuggestionBubble(({ action, suggestion }) => {
    touch("bubble_feedback", undefined, `${action}:${suggestion.kind}`);
    try {
      chrome.runtime.sendMessage({
        type: "AURA_BUBBLE_FEEDBACK",
        feedback: {
          action,
          kind: suggestion.kind,
          reason: suggestion.reason,
          response: suggestion.response,
          at: nowIso()
        }
      });
    } catch {
      // ignore runtime failures
    }
  });
}

async function getOrCreateSessionId(): Promise<string> {
  if (inPageSessionId) return inPageSessionId;

  try {
    const sessionStore = chrome?.storage?.session;
    if (sessionStore?.get && sessionStore?.set) {
      const existing = await sessionStore.get(["aura_session_id"]);
      const id = existing.aura_session_id as string | undefined;
      if (id) {
        inPageSessionId = id;
        return id;
      }
      const newId = crypto.randomUUID();
      await sessionStore.set({ aura_session_id: newId });
      inPageSessionId = newId;
      return newId;
    }
  } catch {
    // storage.session is not always available in content-script contexts.
  }

  inPageSessionId = crypto.randomUUID();
  return inPageSessionId;
}

async function startLoop(): Promise<void> {
  trackActivity();
  const sessionId = await getOrCreateSessionId();
  const bubble = createBubble();

  setInterval(() => {
    const snapshot = buildContextSnapshot({
      sessionId,
      url: window.location.href,
      doc: document,
      state: {
        userActions: [...userActions],
        lastInteractionAtMs,
        repeatedEditCount: repeatedEditCount()
      }
    });

    const suggestion = pickSuggestion({
      snapshot,
      lastShownAtMs: lastBubbleShownAtMs,
      nowMs: Date.now()
    });
    if (suggestion && !bubble.visible) {
      lastBubbleShownAtMs = Date.now();
      bubble.show(suggestion);
      touch("bubble_shown", undefined, suggestion.kind);
    }

    try {
      chrome.runtime.sendMessage({ type: "AURA_SNAPSHOT", snapshot });
    } catch {
      // extension may be unavailable while reloading
    }
  }, SNAPSHOT_INTERVAL_MS);
}

void startLoop();
