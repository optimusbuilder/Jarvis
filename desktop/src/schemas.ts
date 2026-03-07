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

export const runRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
  dry_run: z.boolean().default(true),
  context_snapshot: z.unknown().optional()
});

const maybeLanguage = z
  .string()
  .trim()
  .min(2)
  .max(12)
  .optional();

export const voiceTranscribeRequestSchema = z.object({
  audio_path: z.string().min(1),
  language: maybeLanguage
});

export const voiceRunRequestSchema = voiceTranscribeRequestSchema.extend({
  dry_run: z.boolean().default(true),
  context_snapshot: z.unknown().optional()
});

export const voicePttStartRequestSchema = z.object({
  output_path: z.string().min(1).optional(),
  input_device: z.string().min(1).optional()
});

export const voicePttStopRequestSchema = z.object({
  capture_id: z.string().min(1).optional()
});

export const voiceRespondRequestSchema = z.object({
  text: z.string().min(1).max(1000),
  voice_id: z.string().min(1).optional(),
  speak: z.boolean().default(false),
  output_path: z.string().min(1).optional()
});



export const killSwitchRequestSchema = z.object({
  active: z.boolean(),
  reason: z.string().trim().min(1).max(300).optional()
});

export const toolResultSchema = z.object({
  success: z.boolean(),
  observed_state: z.string().min(1),
  error: z.string().nullable().default(null)
});

export type ToolResult = z.infer<typeof toolResultSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ActionPlan = z.infer<typeof actionPlanSchema>;
