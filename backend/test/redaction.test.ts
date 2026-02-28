import { describe, expect, it } from "vitest";
import type { ContextSnapshot } from "../src/schemas.js";
import { redactContextSnapshot } from "../src/redaction.js";

function baseSnapshot(): ContextSnapshot {
  return {
    session_id: "session-1",
    url: "https://example.com/apply",
    domain: "example.com",
    page_type: "form",
    page_title: "Apply",
    visible_text_chunks: [
      { id: "p:0", text: "This is safe content.", source: "p" },
      { id: "p:1", text: "SSN: 123-45-6789", source: "p" },
      { id: "p:2", text: "Card 4111 1111 1111 1111", source: "p" }
    ],
    active_element: {
      kind: "input",
      label: "Password",
      input_type: "password",
      value_length: 8
    },
    form_fields: [
      {
        field_id: "first_name",
        label: "First name",
        kind: "input",
        input_type: "text",
        required: true,
        is_sensitive: false,
        answered: true
      },
      {
        field_id: "card_number",
        label: "Credit card number",
        kind: "input",
        input_type: "text",
        required: true,
        is_sensitive: false,
        answered: false
      }
    ],
    user_actions: [],
    hesitation_score: 0.2,
    timestamp: new Date().toISOString()
  };
}

describe("redactContextSnapshot", () => {
  it("redacts sensitive visible text, active element, and form fields", () => {
    const out = redactContextSnapshot(baseSnapshot());
    expect(out.snapshot.visible_text_chunks.map((chunk) => chunk.id)).toEqual(["p:0"]);
    expect(out.snapshot.active_element).toBeNull();
    expect(out.snapshot.form_fields.map((field) => field.field_id)).toEqual(["first_name"]);
    expect(out.redactions.length).toBe(4);
  });

  it("keeps non-sensitive context untouched", () => {
    const snap = baseSnapshot();
    snap.visible_text_chunks = [{ id: "p:0", text: "Normal content", source: "p" }];
    snap.active_element = {
      kind: "textarea",
      label: "Cover letter",
      value_length: 20
    };
    snap.form_fields = [
      {
        field_id: "portfolio",
        label: "Portfolio URL",
        kind: "input",
        input_type: "url",
        is_sensitive: false,
        answered: false
      }
    ];

    const out = redactContextSnapshot(snap);
    expect(out.snapshot.visible_text_chunks).toHaveLength(1);
    expect(out.snapshot.active_element).not.toBeNull();
    expect(out.snapshot.form_fields).toHaveLength(1);
    expect(out.redactions).toEqual([]);
  });
});
