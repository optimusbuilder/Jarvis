/**
 * Apple Speech Framework STT — native macOS transcription.
 *
 * Uses `osascript` with ObjC bridge to call SFSpeechRecognizer.
 * This inherits Terminal.app's speech recognition permissions,
 * avoiding the TCC permission issues that plague standalone CLI tools.
 *
 * Advantages over whisper.cpp:
 * - Better accuracy for conversational speech and proper nouns
 * - Adds punctuation automatically
 * - Uses Apple's neural engine (fast on Apple Silicon)
 * - Free, on-device capable
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AppleSTTResult = {
    transcript: string;
    engine: "apple_speech";
    durationMs: number;
};

// ObjC script that calls SFSpeechRecognizer via osascript
function buildAppleSpeechScript(audioPath: string): string {
    // Escape the path for embedding in JXA string
    const escapedPath = audioPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    return `
ObjC.import('Speech');
ObjC.import('Foundation');

// Request authorization first (idempotent if already authorized)
var authDone = false;
$.SFSpeechRecognizer.requestAuthorization(function(status) {
  authDone = true;
});
var authWait = 0;
while (!authDone && authWait < 50) {
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
  authWait++;
}

var audioURL = $.NSURL.fileURLWithPath("${escapedPath}");
var recognizer = $.SFSpeechRecognizer.alloc.initWithLocale($.NSLocale.alloc.initWithLocaleIdentifier("en-US"));
var request = $.SFSpeechURLRecognitionRequest.alloc.initWithURL(audioURL);
request.shouldReportPartialResults = false;
request.addsPunctuation = true;

var done = false;
var transcript = "";
var error_msg = "";

recognizer.recognitionTaskWithRequestResultHandler(request, function(result, error) {
  try {
    // In JXA ObjC bridge, nil objects are truthy — must try/catch property access
    if (error) {
      try {
        error_msg = error.localizedDescription.js;
      } catch(e) {
        // error was $.nil — not a real error, ignore
      }
    }
    if (result) {
      try {
        if (result.isFinal) {
          transcript = result.bestTranscription.formattedString.js;
          done = true;
        }
      } catch(e) {
        done = true;
      }
    }
    if (error_msg) {
      done = true;
    }
  } catch(e) {
    done = true;
  }
});

// Poll until done (max 30 seconds)
var iterations = 0;
while (!done && iterations < 300) {
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
  iterations++;
}

if (error_msg) {
  "APPLE_STT_ERROR: " + error_msg;
} else if (!transcript) {
  "APPLE_STT_ERROR: No transcript produced";
} else {
  transcript;
}
`;
}

/**
 * Transcribe audio using Apple Speech Framework via osascript ObjC bridge.
 * Returns the transcript string, or null if recognition fails.
 */
export async function transcribeWithAppleSpeech(audioPath: string): Promise<AppleSTTResult | null> {
    const startMs = Date.now();

    try {
        const script = buildAppleSpeechScript(audioPath);

        const { stdout, stderr } = await execFileAsync("osascript", [
            "-l", "JavaScript",
            "-e", script,
        ], {
            timeout: 35000,
        });

        const output = stdout.trim();

        // Check for error markers in the output
        if (output.startsWith("APPLE_STT_ERROR:")) {
            console.warn(`  ⚠️  Apple Speech: ${output}`);
            return null;
        }

        if (!output) {
            return null;
        }

        return {
            transcript: output,
            engine: "apple_speech",
            durationMs: Date.now() - startMs,
        };
    } catch (error: any) {
        // Extract stderr from exec error if available
        const stderrMsg = error?.stderr?.trim() ?? "";
        const errMsg = stderrMsg || String(error).slice(0, 200);
        console.warn(`  ⚠️  Apple Speech failed: ${errMsg}`);
        return null;
    }
}
