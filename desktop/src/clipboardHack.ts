import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Extracts the currently highlighted text from any application in macOS.
 * Works by temporarily saving the clipboard, triggering Cmd+C, reading the new clip,
 * and seamlessly restoring the original clipboard so the user never notices.
 */
export async function getHighlightedText(): Promise<string> {
    const script = `
        try
            set oldClip to the clipboard
        on error
            set oldClip to ""
        end try

        tell application "System Events"
            keystroke "c" using command down
        end tell
        
        delay 0.1
        
        try
            set newClip to the clipboard
            -- Restore original clipboard carefully
            if oldClip is not "" then
                set the clipboard to oldClip
            end if
            return newClip
        on error
            return ""
        end try
    `;

    try {
        const { stdout } = await execAsync(`osascript -e '${script}'`);
        return stdout.trim();
    } catch (error) {
        // If nothing is highlighted or accessibility blocks it, it will just fail silently
        // console.warn("Clipboard extraction failed:", error);
        return "";
    }
}
