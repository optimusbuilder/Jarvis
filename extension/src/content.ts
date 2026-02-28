type PageType = "article" | "form" | "product" | "editor" | "search" | "other";

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function inferPageType(): PageType {
  const hasForm = document.querySelector("form, input, textarea, select") !== null;
  if (hasForm) return "form";
  const hasEditor =
    document.querySelector("[contenteditable='true'], textarea") !== null;
  if (hasEditor) return "editor";
  return "other";
}

function textChunks(): Array<{ id: string; text: string; source: "h1" | "p" | "li" | "label" | "other" }> {
  const maxChars = 6000;
  const selectors = ["h1", "p", "li", "label"];
  const out: Array<{ id: string; text: string; source: "h1" | "p" | "li" | "label" | "other" }> = [];

  let used = 0;
  let i = 0;
  for (const sel of selectors) {
    const nodes = Array.from(document.querySelectorAll(sel));
    for (const node of nodes) {
      const t = (node.textContent ?? "").trim().replace(/\s+/g, " ");
      if (!t) continue;
      if (t.length < 3) continue;
      const remaining = maxChars - used;
      if (remaining <= 0) return out;
      const clipped = t.slice(0, remaining);
      out.push({ id: `${sel}:${i++}`, text: clipped, source: sel as any });
      used += clipped.length;
      if (used >= maxChars) return out;
    }
  }
  return out;
}

function activeElementSummary(): null | {
  kind: "input" | "textarea" | "contenteditable" | "select";
  label: string;
  input_type?: string;
  value_length?: number;
} {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return null;

  const tag = el.tagName.toLowerCase();
  const isContentEditable = (el as any).isContentEditable === true;

  let kind: "input" | "textarea" | "contenteditable" | "select" | null = null;
  if (tag === "input") kind = "input";
  if (tag === "textarea") kind = "textarea";
  if (tag === "select") kind = "select";
  if (isContentEditable) kind = "contenteditable";
  if (!kind) return null;

  const aria = el.getAttribute("aria-label") ?? "";
  const name = (el as any).name ?? "";
  const id = el.id ?? "";
  const label =
    aria ||
    (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() : "") ||
    name ||
    "";

  const inputType = tag === "input" ? ((el as HTMLInputElement).type ?? "text") : undefined;
  const valueLength =
    kind === "input" || kind === "textarea"
      ? (((el as HTMLInputElement | HTMLTextAreaElement).value ?? "").length || 0)
      : undefined;

  return {
    kind,
    label,
    input_type: inputType,
    value_length: valueLength
  };
}

function snapshot(sessionId: string) {
  const url = window.location.href;
  return {
    session_id: sessionId,
    url,
    domain: getDomain(url),
    page_type: inferPageType(),
    page_title: document.title ?? "",
    visible_text_chunks: textChunks(),
    active_element: activeElementSummary(),
    form_fields: [],
    user_actions: [],
    hesitation_score: 0,
    timestamp: new Date().toISOString()
  };
}

async function getOrCreateSessionId(): Promise<string> {
  const existing = await chrome.storage.session.get(["aura_session_id"]);
  const id = existing.aura_session_id as string | undefined;
  if (id) return id;
  const newId = crypto.randomUUID();
  await chrome.storage.session.set({ aura_session_id: newId });
  return newId;
}

async function loop() {
  const sessionId = await getOrCreateSessionId();
  setInterval(() => {
    try {
      chrome.runtime.sendMessage({ type: "AURA_SNAPSHOT", snapshot: snapshot(sessionId) });
    } catch {
      // ignore
    }
  }, 5000);
}

void loop();

