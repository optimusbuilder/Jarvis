import type {
  ActiveElementSummary,
  ContextSnapshot,
  FormFieldSummary,
  PageType,
  UserAction,
  VisibleTextChunk
} from "./types.js";

const sensitiveInputTypes = new Set([
  "password",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year"
]);

const sensitiveLabelRegex =
  /\b(password|passcode|pin|otp|security code|cvv|cvc|credit card|debit card|card number|ssn|social security|tax id|iban|routing|account number)\b/i;

const possibleSsnRegex = /\b\d{3}-\d{2}-\d{4}\b/;
const possibleCardRegex = /\b(?:\d[ -]*?){13,19}\b/;

export type SnapshotState = {
  userActions: UserAction[];
  lastInteractionAtMs: number;
  repeatedEditCount: number;
};

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function hasSensitiveText(input: string): boolean {
  return possibleSsnRegex.test(input) || possibleCardRegex.test(input);
}

function isSensitiveField(args: {
  label: string;
  inputType?: string;
  autocomplete?: string | null;
}): boolean {
  const type = (args.inputType ?? "").toLowerCase();
  const autocomplete = (args.autocomplete ?? "").toLowerCase();
  if (sensitiveInputTypes.has(type)) return true;
  if (autocomplete.includes("cc-")) return true;
  return sensitiveLabelRegex.test(args.label);
}

function isElementHidden(el: Element): boolean {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el instanceof HTMLInputElement && el.type.toLowerCase() === "hidden") return true;
  const style = (el as HTMLElement).style;
  if (!style) return false;
  if (style.display === "none" || style.visibility === "hidden") return true;
  return false;
}

function isElementLikelyVisible(el: Element): boolean {
  if (isElementHidden(el)) return false;
  let current: Element | null = el;
  while (current) {
    if (isElementHidden(current)) return false;
    current = current.parentElement;
  }
  return true;
}

function labelFromElement(el: Element, doc: Document): string {
  const htmlEl = el as HTMLElement;
  const aria = htmlEl.getAttribute("aria-label");
  if (aria && aria.trim()) return normalizeText(aria);

  if ("labels" in htmlEl) {
    const labels = (htmlEl as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).labels;
    if (labels && labels.length > 0) {
      const text = normalizeText(labels[0].textContent ?? "");
      if (text) return text;
    }
  }

  const id = (htmlEl as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).id ?? "";
  if (id) {
    const fromFor =
      Array.from(doc.querySelectorAll("label")).find((label) => label.htmlFor === id)?.textContent ??
      "";
    const normalized = normalizeText(fromFor);
    if (normalized) return normalized;
  }

  const closestLabel = htmlEl.closest("label")?.textContent ?? "";
  const normalizedClosest = normalizeText(closestLabel);
  if (normalizedClosest) return normalizedClosest;

  const name = (htmlEl as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).name ?? "";
  if (name.trim()) return name.trim();

  const placeholder = (htmlEl as HTMLInputElement | HTMLTextAreaElement).placeholder ?? "";
  if (placeholder.trim()) return normalizeText(placeholder);

  return "";
}

function inferPageType(doc: Document): PageType {
  const hasForm = doc.querySelector("form, input, textarea, select") !== null;
  const hasEditor = doc.querySelector("[contenteditable='true'], textarea") !== null;
  const hasSearch =
    doc.querySelector("input[type='search'], form[action*='search']") !== null ||
    doc.location.search.includes("q=");
  const hasProduct =
    doc.querySelector("[itemtype*='Product'], [data-product], [class*='price'], [id*='price']") !== null;
  const hasArticle = doc.querySelector("article, main h1 + p, p") !== null;

  if (hasForm) return "form";
  if (hasEditor) return "editor";
  if (hasSearch) return "search";
  if (hasProduct) return "product";
  if (hasArticle) return "article";
  return "other";
}

export function collectVisibleTextChunks(doc: Document): VisibleTextChunk[] {
  const maxChars = 6000;
  const selectors: Array<{ selector: string; source: VisibleTextChunk["source"] }> = [
    { selector: "h1", source: "h1" },
    { selector: "p", source: "p" },
    { selector: "li", source: "li" },
    { selector: "label", source: "label" }
  ];

  const out: VisibleTextChunk[] = [];
  let used = 0;
  let index = 0;

  for (const entry of selectors) {
    const nodes = Array.from(doc.querySelectorAll(entry.selector));
    for (const node of nodes) {
      if (!isElementLikelyVisible(node)) continue;
      const text = normalizeText(node.textContent ?? "");
      if (!text || text.length < 3) continue;
      if (hasSensitiveText(text)) continue;
      const remaining = maxChars - used;
      if (remaining <= 0) return out;
      const clipped = text.slice(0, remaining);
      out.push({
        id: `${entry.selector}:${index++}`,
        text: clipped,
        source: entry.source
      });
      used += clipped.length;
      if (used >= maxChars) return out;
    }
  }
  return out;
}

export function collectFormFields(doc: Document): FormFieldSummary[] {
  const nodes = Array.from(doc.querySelectorAll("input, textarea, select"));
  const out: FormFieldSummary[] = [];
  let index = 0;

  for (const node of nodes) {
    if (!isElementLikelyVisible(node)) continue;

    const tag = node.tagName.toLowerCase();
    const kind = tag === "input" ? "input" : tag === "textarea" ? "textarea" : "select";
    const inputType = tag === "input" ? (node as HTMLInputElement).type ?? "text" : undefined;
    const label = labelFromElement(node, doc);
    const autocomplete = (node as HTMLInputElement).autocomplete ?? null;
    if (isSensitiveField({ label, inputType, autocomplete })) continue;

    const fieldId =
      (node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).id ||
      (node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).name ||
      `${tag}:${index}`;

    let answered = false;
    if (node instanceof HTMLInputElement && (node.type === "checkbox" || node.type === "radio")) {
      answered = node.checked;
    } else if (node instanceof HTMLSelectElement) {
      answered = normalizeText(node.value).length > 0;
    } else if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      answered = normalizeText(node.value).length > 0;
    }

    out.push({
      field_id: fieldId,
      label,
      kind,
      input_type: inputType,
      required: (node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).required,
      is_sensitive: false,
      answered
    });
    index += 1;
  }

  return out;
}

export function summarizeActiveElement(doc: Document): ActiveElementSummary | null {
  const el = doc.activeElement as HTMLElement | null;
  if (!el) return null;
  if (!isElementLikelyVisible(el)) return null;

  const tag = el.tagName.toLowerCase();
  const isContentEditable = el.isContentEditable === true;
  const kind =
    tag === "input"
      ? "input"
      : tag === "textarea"
        ? "textarea"
        : tag === "select"
          ? "select"
          : isContentEditable
            ? "contenteditable"
            : null;
  if (!kind) return null;

  const label = labelFromElement(el, doc);
  const inputType = kind === "input" ? (el as HTMLInputElement).type ?? "text" : undefined;
  const autocomplete = kind === "input" ? (el as HTMLInputElement).autocomplete ?? null : null;
  if (isSensitiveField({ label, inputType, autocomplete })) return null;

  let valueLength: number | undefined;
  if (kind === "input" || kind === "textarea") {
    valueLength = ((el as HTMLInputElement | HTMLTextAreaElement).value ?? "").length;
  }
  if (kind === "contenteditable") {
    valueLength = normalizeText(el.textContent ?? "").length;
  }

  return {
    kind,
    label,
    input_type: inputType,
    value_length: valueLength
  };
}

function deriveTopic(doc: Document): string | undefined {
  const title = normalizeText(doc.title ?? "");
  if (!title) return undefined;
  const words = title.split(" ").slice(0, 6).join(" ");
  return words || undefined;
}

function calculateHesitationScore(state: SnapshotState): number {
  const inactivityMs = Math.max(0, Date.now() - state.lastInteractionAtMs);
  const inactivityComponent = Math.min(0.75, inactivityMs / 20000);
  const editComponent = Math.min(0.25, Math.max(0, state.repeatedEditCount) * 0.08);
  const raw = inactivityComponent + editComponent;
  return Number(Math.min(1, raw).toFixed(2));
}

export function buildContextSnapshot(args: {
  sessionId: string;
  url: string;
  doc: Document;
  state: SnapshotState;
}): ContextSnapshot {
  const doc = args.doc;
  return {
    session_id: args.sessionId,
    url: args.url,
    domain: getDomain(args.url),
    page_type: inferPageType(doc),
    page_title: doc.title ?? "",
    visible_text_chunks: collectVisibleTextChunks(doc),
    active_element: summarizeActiveElement(doc),
    form_fields: collectFormFields(doc),
    user_actions: args.state.userActions.map((action) => ({ ...action })),
    hesitation_score: calculateHesitationScore(args.state),
    tab_cluster_topic: deriveTopic(doc),
    timestamp: new Date().toISOString()
  };
}
