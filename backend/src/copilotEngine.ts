import type { ContextSnapshot, CopilotResponse } from "./schemas.js";

export type CopilotFeedbackSummary = {
  accepts: number;
  dismisses: number;
};

type CopilotIntent = "researching" | "applying" | "comparing" | "writing" | "purchasing" | "unknown";

type CopilotDecisionContext = {
  intent: CopilotIntent;
  confidence: number;
  need: number;
  value: number;
  score: number;
  threshold: number;
  friction: {
    hesitation: number;
    pause_ms: number;
    repeated_edits: number;
    tab_switches: number;
    unanswered_required: number;
  };
};

type CopilotDecision = {
  response: CopilotResponse;
  decision: CopilotDecisionContext;
};

const sensitiveDomainPatterns = [
  /accounts\./i,
  /bank/i,
  /billing/i,
  /checkout/i,
  /payment/i,
  /tax/i,
  /insurance/i,
  /health/i
];

function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function percent(value: number): string {
  return `${Math.round(clamp(value) * 100)}%`;
}

function actionTypes(snapshot: ContextSnapshot): string[] {
  return snapshot.user_actions
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const value = (item as Record<string, unknown>).type;
      return typeof value === "string" ? value : "";
    })
    .filter(Boolean);
}

function numericActionField(item: unknown, fieldName: string): number | null {
  if (!item || typeof item !== "object") return null;
  const value = (item as Record<string, unknown>)[fieldName];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function frictionSignals(snapshot: ContextSnapshot): CopilotDecisionContext["friction"] {
  let maxPauseMs = 0;
  let repeatedEdits = 0;
  let tabSwitches = 0;

  for (const action of snapshot.user_actions) {
    const type = typeof action === "object" && action ? String((action as Record<string, unknown>).type ?? "") : "";
    if (type === "cursor_idle") {
      const pause = numericActionField(action, "ms");
      if (pause && pause > maxPauseMs) maxPauseMs = pause;
    }
    if (type === "repeated_edit") repeatedEdits += 1;
    if (type === "text_edit_burst") {
      const count = numericActionField(action, "count");
      if (count) repeatedEdits += Math.max(1, Math.floor(count / 2));
    }
    if (type === "tab_switch") tabSwitches += 1;
  }

  const unansweredRequired = snapshot.form_fields.filter(
    (field) => field.required === true && field.answered === false && field.is_sensitive !== true
  ).length;

  return {
    hesitation: clamp(snapshot.hesitation_score),
    pause_ms: Math.max(0, maxPauseMs),
    repeated_edits: repeatedEdits,
    tab_switches: tabSwitches,
    unanswered_required: unansweredRequired
  };
}

function inferIntent(snapshot: ContextSnapshot): CopilotIntent {
  if (snapshot.page_type === "form") return "applying";
  if (snapshot.page_type === "product") return "purchasing";
  if (snapshot.page_type === "editor") return "writing";
  if (snapshot.page_type === "search") return "researching";
  if (snapshot.page_type === "article") {
    const types = actionTypes(snapshot);
    if (types.filter((item) => item === "tab_switch").length >= 2) return "comparing";
    return "researching";
  }
  return "unknown";
}

function confidenceScore(snapshot: ContextSnapshot, intent: CopilotIntent): number {
  const chunks = snapshot.visible_text_chunks.length;
  const hasActiveElement = snapshot.active_element != null;
  const hasTopic = Boolean(snapshot.tab_cluster_topic && snapshot.tab_cluster_topic.trim());
  const base = 0.45;
  const chunkBoost = chunks >= 8 ? 0.22 : chunks >= 4 ? 0.14 : chunks >= 1 ? 0.08 : 0;
  const intentBoost = intent === "unknown" ? 0.05 : 0.18;
  const activityBoost = hasActiveElement ? 0.1 : hasTopic ? 0.06 : 0;
  return clamp(base + chunkBoost + intentBoost + activityBoost);
}

function needScore(friction: CopilotDecisionContext["friction"]): number {
  const hesitation = friction.hesitation;
  const pause = clamp(friction.pause_ms / 9000);
  const edits = clamp(friction.repeated_edits / 4);
  const switches = clamp(friction.tab_switches / 4);
  const required = clamp(friction.unanswered_required / 3);
  return clamp(hesitation * 0.3 + pause * 0.2 + edits * 0.2 + switches * 0.15 + required * 0.15);
}

function valueScore(intent: CopilotIntent): number {
  switch (intent) {
    case "applying":
      return 0.9;
    case "purchasing":
      return 0.88;
    case "comparing":
      return 0.83;
    case "writing":
      return 0.82;
    case "researching":
      return 0.78;
    default:
      return 0.62;
  }
}

function thresholdWithFeedback(feedback?: CopilotFeedbackSummary): number {
  const accepts = feedback?.accepts ?? 0;
  const dismisses = feedback?.dismisses ?? 0;
  const threshold = 0.23 + dismisses * 0.035 - accepts * 0.02;
  return clamp(threshold, 0.16, 0.55);
}

function hasVisiblePrice(snapshot: ContextSnapshot): boolean {
  return snapshot.visible_text_chunks.some((chunk) => /\$\d|€\d|£\d/.test(chunk.text));
}

function isSensitiveDomain(snapshot: ContextSnapshot): boolean {
  return sensitiveDomainPatterns.some((pattern) => pattern.test(snapshot.domain) || pattern.test(snapshot.url));
}

function groundedReason(args: {
  snapshot: ContextSnapshot;
  intent: CopilotIntent;
  friction: CopilotDecisionContext["friction"];
}): string {
  const evidence: string[] = [];
  if (args.friction.hesitation >= 0.45) evidence.push(`hesitation ${percent(args.friction.hesitation)}`);
  if (args.friction.pause_ms >= 3000) evidence.push(`pause ${Math.round(args.friction.pause_ms / 1000)}s`);
  if (args.friction.repeated_edits > 0) evidence.push(`repeated edits ${args.friction.repeated_edits}`);
  if (args.friction.tab_switches > 0) evidence.push(`tab switches ${args.friction.tab_switches}`);
  if (args.friction.unanswered_required > 0) evidence.push(`unanswered required fields ${args.friction.unanswered_required}`);
  const joinedEvidence = evidence.length ? evidence.join(", ") : "visible context";

  switch (args.intent) {
    case "applying": {
      const label = args.snapshot.active_element?.label || "this field";
      return `Form friction detected around “${label}” from ${joinedEvidence}.`;
    }
    case "researching":
      return `Research friction detected from ${joinedEvidence}.`;
    case "writing":
      return `Writing friction detected from ${joinedEvidence}.`;
    case "purchasing":
      return `Purchase-comparison friction detected from ${joinedEvidence}.`;
    case "comparing":
      return `Comparison friction detected from ${joinedEvidence}.`;
    default:
      return `Potential friction detected from ${joinedEvidence}.`;
  }
}

function responseForIntent(args: {
  snapshot: ContextSnapshot;
  intent: CopilotIntent;
}): { response: string; ui_action: Record<string, unknown> | null } {
  switch (args.intent) {
    case "applying": {
      const label = args.snapshot.active_element?.label || "this answer";
      return {
        response: `I can draft a concise STAR-style answer starter for “${label}” in 2-3 lines.`,
        ui_action: { type: "bubble", kind: "form" }
      };
    }
    case "researching":
      return {
        response: "I can consolidate this into a 3-point summary with key takeaways and open questions.",
        ui_action: { type: "bubble", kind: "summary" }
      };
    case "writing":
      return {
        response: "I can rewrite this section to keep the same meaning with a clearer, more consistent tone.",
        ui_action: { type: "bubble", kind: "rewrite" }
      };
    case "purchasing": {
      const mentionPrice = hasVisiblePrice(args.snapshot)
        ? "using visible price/features"
        : "using visible specs";
      return {
        response: `I can create a quick tradeoff comparison ${mentionPrice} so you can pick faster.`,
        ui_action: { type: "bubble", kind: "comparison" }
      };
    }
    case "comparing":
      return {
        response: "I can produce a side-by-side comparison summary from these tabs.",
        ui_action: { type: "bubble", kind: "comparison" }
      };
    default:
      return {
        response: "I can help with a concise next step based on the visible context.",
        ui_action: { type: "bubble", kind: "suggestion" }
      };
  }
}

function shouldIntervene(args: CopilotDecisionContext): boolean {
  return args.score >= args.threshold && args.need >= 0.28 && args.confidence >= 0.55;
}

export function decideCopilot(args: {
  snapshot?: ContextSnapshot;
  feedback?: CopilotFeedbackSummary;
}): CopilotDecision {
  if (!args.snapshot) {
    const threshold = thresholdWithFeedback(args.feedback);
    return {
      response: {
        intervene: false,
        reason: "No context snapshot provided.",
        response: "",
        ui_action: null
      },
      decision: {
        intent: "unknown",
        confidence: 0,
        need: 0,
        value: 0,
        score: 0,
        threshold,
        friction: {
          hesitation: 0,
          pause_ms: 0,
          repeated_edits: 0,
          tab_switches: 0,
          unanswered_required: 0
        }
      }
    };
  }

  const snapshot = args.snapshot;
  const intent = inferIntent(snapshot);
  const friction = frictionSignals(snapshot);
  const confidence = confidenceScore(snapshot, intent);
  const need = needScore(friction);
  const value = valueScore(intent);
  const score = clamp(confidence * need * value);
  const threshold = thresholdWithFeedback(args.feedback);

  if (isSensitiveDomain(snapshot)) {
    return {
      response: {
        intervene: false,
        reason: "Sensitive domain detected; copilot stays silent by policy.",
        response: "",
        ui_action: null
      },
      decision: {
        intent,
        confidence,
        need,
        value,
        score,
        threshold,
        friction
      }
    };
  }

  const decisionContext: CopilotDecisionContext = {
    intent,
    confidence,
    need,
    value,
    score,
    threshold,
    friction
  };

  if (!shouldIntervene(decisionContext)) {
    return {
      response: {
        intervene: false,
        reason: `Intervention score ${score.toFixed(2)} below threshold ${threshold.toFixed(2)}.`,
        response: "",
        ui_action: null
      },
      decision: decisionContext
    };
  }

  const answer = responseForIntent({ snapshot, intent });
  return {
    response: {
      intervene: true,
      reason: groundedReason({ snapshot, intent, friction }),
      response: answer.response,
      ui_action: answer.ui_action
    },
    decision: decisionContext
  };
}
