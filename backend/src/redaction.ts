import type { ContextSnapshot } from "./schemas.js";

export type RedactionEvent = {
  category: "visible_text" | "active_element" | "form_field";
  reason: string;
  ref?: string;
};

const sensitiveInputTypes = new Set([
  "password",
  "tel",
  "number",
  "email",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year"
]);

const sensitiveLabelRegex =
  /\b(password|passcode|pin|otp|one[-\s]?time|2fa|security code|cvv|cvc|card|credit|debit|ssn|social security|tax id|iban|routing|account number)\b/i;

const possibleSsnRegex = /\b\d{3}-\d{2}-\d{4}\b/;
const possibleCardRegex = /\b(?:\d[ -]*?){13,19}\b/;

function isSensitiveField(label: string, inputType?: string, explicitSensitive = false): boolean {
  if (explicitSensitive) return true;
  if (inputType && sensitiveInputTypes.has(inputType.toLowerCase())) return true;
  return sensitiveLabelRegex.test(label);
}

function hasSensitiveContent(text: string): boolean {
  return possibleSsnRegex.test(text) || possibleCardRegex.test(text);
}

export function redactContextSnapshot(snapshot: ContextSnapshot): {
  snapshot: ContextSnapshot;
  redactions: RedactionEvent[];
} {
  const redactions: RedactionEvent[] = [];

  const visible_text_chunks = snapshot.visible_text_chunks.filter((chunk) => {
    const redact = hasSensitiveContent(chunk.text);
    if (redact) {
      redactions.push({
        category: "visible_text",
        reason: "sensitive_pattern_detected",
        ref: chunk.id
      });
    }
    return !redact;
  });

  const form_fields = snapshot.form_fields.filter((field) => {
    const redact = isSensitiveField(field.label, field.input_type, field.is_sensitive);
    if (redact) {
      redactions.push({
        category: "form_field",
        reason: "sensitive_form_field",
        ref: field.field_id
      });
    }
    return !redact;
  });

  let active_element = snapshot.active_element;
  if (
    active_element &&
    isSensitiveField(active_element.label, active_element.input_type, false)
  ) {
    redactions.push({
      category: "active_element",
      reason: "sensitive_active_element",
      ref: active_element.label || active_element.kind
    });
    active_element = null;
  }

  return {
    snapshot: {
      ...snapshot,
      visible_text_chunks,
      form_fields,
      active_element
    },
    redactions
  };
}
