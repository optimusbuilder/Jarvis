import { z } from "zod";

export const planRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
  desktop_state: z.unknown().optional(),
  context_snapshot: z.unknown().optional()
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

export const ttsRequestSchema = z.object({
  text: z.string().min(1).max(1000),
  voice_id: z.string().min(1).optional()
});

export type PlanRequest = z.infer<typeof planRequestSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ActionPlan = z.infer<typeof actionPlanSchema>;
