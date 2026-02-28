import { z } from "zod";

export const desktopStateSchema = z
  .object({
    os: z.literal("macos"),
    frontmost_app: z.string().min(1),
    frontmost_window_title: z.string().optional(),
    active_url: z.string().url().optional()
  })
  .passthrough();

export const contextSnapshotSchema = z
  .object({
    session_id: z.string().min(1),
    url: z.string().url(),
    domain: z.string().min(1),
    page_type: z.enum(["article", "form", "product", "editor", "search", "other"]),
    page_title: z.string().default(""),
    visible_text_chunks: z
      .array(
        z.object({
          id: z.string().min(1),
          text: z.string().min(0),
          source: z.enum(["h1", "p", "li", "label", "other"])
        })
      )
      .default([]),
    active_element: z
      .object({
        kind: z.enum(["input", "textarea", "contenteditable", "select"]),
        label: z.string().default(""),
        input_type: z.string().optional(),
        value_length: z.number().int().nonnegative().optional()
      })
      .nullable()
      .default(null),
    form_fields: z
      .array(
        z.object({
          field_id: z.string().min(1),
          label: z.string().default(""),
          kind: z.enum(["input", "textarea", "select"]),
          input_type: z.string().optional(),
          required: z.boolean().optional(),
          is_sensitive: z.boolean(),
          answered: z.boolean()
        })
      )
      .default([]),
    user_actions: z.array(z.any()).default([]),
    hesitation_score: z.number().min(0).max(1).default(0),
    tab_cluster_topic: z.string().optional(),
    timestamp: z.string().min(1)
  })
  .passthrough();

export const planRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
  desktop_state: desktopStateSchema.optional(),
  context_snapshot: contextSnapshotSchema.optional()
});

export const toolCallSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.any()).default({})
});

export const actionPlanSchema = z.object({
  goal: z.string().min(1),
  questions: z.array(z.string()).default([]),
  tool_calls: z.array(toolCallSchema).default([])
});

export const copilotResponseSchema = z.object({
  intervene: z.boolean(),
  reason: z.string().default(""),
  response: z.string().default(""),
  ui_action: z.any().nullable().default(null)
});

export const ttsRequestSchema = z.object({
  text: z.string().min(1).max(1000),
  voice_id: z.string().min(1).optional()
});

export type DesktopState = z.infer<typeof desktopStateSchema>;
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;
export type PlanRequest = z.infer<typeof planRequestSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ActionPlan = z.infer<typeof actionPlanSchema>;
export type CopilotResponse = z.infer<typeof copilotResponseSchema>;
