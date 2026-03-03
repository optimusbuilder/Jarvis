import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const execAsync = promisify(exec);

export type MimeData = {
    inlineData: {
        data: string; // Base64 encoded string
        mimeType: string;
    };
};

/**
 * Captures the primary macOS screen to a temporary file,
 * reads it as base64, cleans up the file, and returns the
 * format expected by the Gemini API's `inlineData` parts.
 */
export async function captureScreenMimeData(): Promise<MimeData> {
    const tempPath = resolve(tmpdir(), `jarvis-screen-${Date.now()}.jpg`);

    try {
        // -x = do not play sounds
        // -t jpg = format to jpg for smaller size
        // -C = capture cursor as well
        await execAsync(`screencapture -x -t jpg -C "${tempPath}"`);

        if (!existsSync(tempPath)) {
            throw new Error("Failed to capture screen: File not created.");
        }

        const buffer = readFileSync(tempPath);
        const base64Data = buffer.toString("base64");

        return {
            inlineData: {
                data: base64Data,
                mimeType: "image/jpeg",
            },
        };
    } finally {
        // Always clean up the temp file
        if (existsSync(tempPath)) {
            try {
                unlinkSync(tempPath);
            } catch {
                // Ignore cleanup errors
            }
        }
    }
}
