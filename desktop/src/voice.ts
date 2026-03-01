import { constants } from "node:fs";
import { access } from "node:fs/promises";
import type { Env } from "./env.js";

export type WhisperTranscriber = (args: {
  env: Env;
  audioPath: string;
  language?: string;
}) => Promise<string>;

export type TranscriptQuality = "good" | "repeat";

export type TranscriptAssessment = {
  transcript: string;
  normalized_transcript: string;
  quality: TranscriptQuality;
  reason: string;
  word_count: number;
  char_count: number;
};

const lowSignalRegex =
  /\[(?:noise|music|inaudible|silence)\]|\((?:noise|music|inaudible|silence)\)|^\W*$/i;

function normalizeTranscript(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function assessTranscriptQuality(args: {
  transcript: string;
  minWords: number;
  minChars: number;
}): TranscriptAssessment {
  const transcript = args.transcript.trim();
  const normalized = normalizeTranscript(transcript);
  const words = normalized ? normalized.split(" ").filter(Boolean) : [];
  const wordCount = words.length;
  const charCount = normalized.replace(/\s+/g, "").length;

  if (!normalized || lowSignalRegex.test(normalized)) {
    return {
      transcript,
      normalized_transcript: normalized,
      quality: "repeat",
      reason: "No clear speech was detected. Please repeat.",
      word_count: wordCount,
      char_count: charCount
    };
  }

  if (charCount < args.minChars || wordCount < args.minWords) {
    return {
      transcript,
      normalized_transcript: normalized,
      quality: "repeat",
      reason: "The command was too short or unclear. Please repeat.",
      word_count: wordCount,
      char_count: charCount
    };
  }

  return {
    transcript,
    normalized_transcript: normalized,
    quality: "good",
    reason: "Transcript quality is sufficient for planning.",
    word_count: wordCount,
    char_count: charCount
  };
}

export async function transcribeAudio(args: {
  env: Env;
  audioPath: string;
  language?: string;
  minWords: number;
  minChars: number;
  transcriber: WhisperTranscriber;
}): Promise<TranscriptAssessment> {
  try {
    await access(args.audioPath, constants.R_OK);
  } catch {
    throw new Error(`audio_not_found:${args.audioPath}`);
  }

  const transcript = await args.transcriber({
    env: args.env,
    audioPath: args.audioPath,
    language: args.language
  });
  return assessTranscriptQuality({
    transcript,
    minWords: args.minWords,
    minChars: args.minChars
  });
}
