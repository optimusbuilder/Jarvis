import { describe, expect, it } from "vitest";
import { pickSuggestion } from "../src/bubble.js";
import { buildContextSnapshot } from "../src/snapshot.js";

describe("extension snapshot privacy", () => {
  it("redacts sensitive text and fields before sending", () => {
    document.body.innerHTML = `
      <main>
        <h1>Job Application</h1>
        <p>This paragraph is safe.</p>
        <p>SSN: 123-45-6789</p>
        <form>
          <label for="firstName">First name</label>
          <input id="firstName" name="firstName" type="text" value="Ada" required />

          <label for="password">Password</label>
          <input id="password" name="password" type="password" value="secret" />

          <label for="cardNumber">Credit Card Number</label>
          <input id="cardNumber" name="cardNumber" type="text" value="4111111111111111" />

          <input id="hiddenInternal" name="internal" type="hidden" value="hidden" />
        </form>
      </main>
    `;

    const password = document.getElementById("password") as HTMLInputElement;
    password.focus();

    const snapshot = buildContextSnapshot({
      sessionId: "sess-1",
      url: "https://example.com/apply",
      doc: document,
      state: {
        userActions: [{ type: "edit", at: new Date().toISOString(), target: "password" }],
        lastInteractionAtMs: Date.now() - 12000,
        repeatedEditCount: 3
      }
    });

    expect(snapshot.visible_text_chunks.some((chunk) => chunk.text.includes("123-45-6789"))).toBe(false);
    expect(snapshot.form_fields.map((field) => field.field_id)).toEqual(["firstName"]);
    expect(snapshot.active_element).toBeNull();
    expect(snapshot.page_type).toBe("form");
    expect(snapshot.hesitation_score).toBeGreaterThan(0);
  });
});

describe("bubble suggestion heuristics", () => {
  it("suggests form help when user hesitates on active field", () => {
    const snapshot = buildContextSnapshot({
      sessionId: "sess-2",
      url: "https://example.com/form",
      doc: document,
      state: {
        userActions: [],
        lastInteractionAtMs: Date.now() - 16000,
        repeatedEditCount: 4
      }
    });
    const suggestion = pickSuggestion({
      snapshot: {
        ...snapshot,
        page_type: "form",
        active_element: {
          kind: "textarea",
          label: "Why do you want this role?",
          value_length: 0
        }
      },
      lastShownAtMs: 0,
      nowMs: Date.now()
    });
    expect(suggestion?.kind).toBe("form");
  });
});
