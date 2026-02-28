import { z } from "zod";

export const toolCallSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.any()).default({})
});

export const actionPlanSchema = z.object({
  goal: z.string().min(1),
  questions: z.array(z.string()).default([]),
  tool_calls: z.array(toolCallSchema).default([])
});

export const executeRequestSchema = z.object({
  dry_run: z.boolean().default(false),
  plan: actionPlanSchema
});

export const toolResultSchema = z.object({
  success: z.boolean(),
  observed_state: z.string(),
  error: z.string().nullable().default(null)
});

export type ToolResult = z.infer<typeof toolResultSchema>;

