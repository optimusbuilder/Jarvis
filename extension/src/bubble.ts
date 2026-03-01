import type { ContextSnapshot } from "./types.js";

export type BubbleSuggestion = {
  kind: "form" | "article" | "product";
  reason: string;
  response: string;
};

export function pickSuggestion(args: {
  snapshot: ContextSnapshot;
  lastShownAtMs: number;
  nowMs: number;
}): BubbleSuggestion | null {
  const cooldownMs = 30000;
  if (args.nowMs - args.lastShownAtMs < cooldownMs) return null;
  const snap = args.snapshot;

  if (snap.page_type === "form" && snap.hesitation_score >= 0.45 && snap.active_element) {
    const label = snap.active_element.label || "this field";
    return {
      kind: "form",
      reason: `You paused on “${label}”.`,
      response: "Want a quick draft answer starter?"
    };
  }

  if (snap.page_type === "article" && snap.visible_text_chunks.length >= 6) {
    return {
      kind: "article",
      reason: "This page has enough content to consolidate.",
      response: "Want a 3-point summary?"
    };
  }

  if (
    snap.page_type === "product" &&
    snap.visible_text_chunks.some((chunk) => /\$\d/.test(chunk.text))
  ) {
    return {
      kind: "product",
      reason: "Product details and pricing are visible.",
      response: "Want a quick value comparison checklist?"
    };
  }

  return null;
}

export class SuggestionBubble {
  private root: HTMLDivElement | null = null;
  private reasonEl: HTMLDivElement | null = null;
  private responseEl: HTMLDivElement | null = null;
  private isVisible = false;

  constructor(
    private onAction: (args: { action: "accept" | "dismiss"; suggestion: BubbleSuggestion; session_id?: string }) => void
  ) {}

  private sessionId: string | null = null;

  private ensureMounted(): void {
    if (this.root) return;

    const root = document.createElement("div");
    root.setAttribute("data-aura-bubble", "true");
    root.style.position = "fixed";
    root.style.right = "16px";
    root.style.bottom = "16px";
    root.style.maxWidth = "300px";
    root.style.background = "#111827";
    root.style.color = "#f9fafb";
    root.style.borderRadius = "12px";
    root.style.boxShadow = "0 10px 25px rgba(0,0,0,0.25)";
    root.style.padding = "12px";
    root.style.fontFamily = "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    root.style.fontSize = "13px";
    root.style.lineHeight = "1.35";
    root.style.zIndex = "2147483647";
    root.style.display = "none";

    const title = document.createElement("div");
    title.textContent = "AURA";
    title.style.fontWeight = "700";
    title.style.marginBottom = "6px";

    const reason = document.createElement("div");
    reason.style.opacity = "0.9";
    reason.style.marginBottom = "6px";

    const response = document.createElement("div");
    response.style.marginBottom = "10px";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.justifyContent = "flex-end";

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.style.border = "1px solid #374151";
    dismissBtn.style.background = "transparent";
    dismissBtn.style.color = "#d1d5db";
    dismissBtn.style.borderRadius = "8px";
    dismissBtn.style.padding = "6px 10px";
    dismissBtn.style.cursor = "pointer";

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.textContent = "Accept";
    acceptBtn.style.border = "1px solid #4f46e5";
    acceptBtn.style.background = "#4f46e5";
    acceptBtn.style.color = "white";
    acceptBtn.style.borderRadius = "8px";
    acceptBtn.style.padding = "6px 10px";
    acceptBtn.style.cursor = "pointer";

    actions.append(dismissBtn, acceptBtn);
    root.append(title, reason, response, actions);
    document.documentElement.append(root);

    this.root = root;
    this.reasonEl = reason;
    this.responseEl = response;

    dismissBtn.addEventListener("click", () => {
      const suggestion = this.currentSuggestion;
      if (!suggestion) return;
      this.hide();
      this.onAction({ action: "dismiss", suggestion, session_id: this.sessionId ?? undefined });
    });
    acceptBtn.addEventListener("click", () => {
      const suggestion = this.currentSuggestion;
      if (!suggestion) return;
      this.hide();
      this.onAction({ action: "accept", suggestion, session_id: this.sessionId ?? undefined });
    });
  }

  private currentSuggestion: BubbleSuggestion | null = null;

  show(suggestion: BubbleSuggestion): void {
    this.ensureMounted();
    if (!this.root || !this.reasonEl || !this.responseEl) return;
    this.currentSuggestion = suggestion;
    this.reasonEl.textContent = suggestion.reason;
    this.responseEl.textContent = suggestion.response;
    this.root.style.display = "block";
    this.isVisible = true;
  }

  hide(): void {
    if (!this.root) return;
    this.root.style.display = "none";
    this.currentSuggestion = null;
    this.isVisible = false;
  }

  get visible(): boolean {
    return this.isVisible;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }
}
