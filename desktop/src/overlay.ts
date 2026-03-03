/**
 * Overlay — native macOS floating panel for Jarvis responses.
 *
 * Shows a frosted-glass panel at the bottom of the screen while
 * Jarvis is speaking, similar to Siri's response overlay.
 *
 * Uses a compiled Swift binary (jarvis-overlay) that renders
 * a native NSPanel with NSVisualEffectView.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

let overlayProcess: ChildProcess | null = null;

function getOverlayBinaryPath(): string {
    return resolve(process.cwd(), "desktop", "assets", "jarvis-overlay");
}

/**
 * Show the response overlay on screen.
 * Automatically dismisses after `dismissAfterSec` seconds,
 * or can be dismissed early with `dismissOverlay()`.
 */
export function showOverlay(args: {
    text: string;
    title?: string;
    dismissAfterSec?: number;
}): void {
    // Dismiss any existing overlay first
    dismissOverlay();

    const binaryPath = getOverlayBinaryPath();
    if (!existsSync(binaryPath)) {
        console.warn("  ⚠️  Overlay binary not found, skipping overlay display");
        return;
    }

    const cmdArgs = [
        "--text", args.text,
        "--title", args.title ?? "Jarvis",
        "--dismiss", String(args.dismissAfterSec ?? 30),
    ];

    overlayProcess = spawn(binaryPath, cmdArgs, {
        stdio: ["pipe", "ignore", "ignore"],
        detached: true,
    });

    overlayProcess.on("error", (err) => {
        console.warn(`  ⚠️  Overlay error: ${err.message}`);
        overlayProcess = null;
    });

    overlayProcess.on("exit", () => {
        overlayProcess = null;
    });
}

/**
 * Dismiss the currently visible overlay (if any).
 * Sends "dismiss" to the overlay's stdin for a smooth fade-out.
 */
export function dismissOverlay(): void {
    if (!overlayProcess) return;

    try {
        if (overlayProcess.stdin && !overlayProcess.stdin.destroyed) {
            overlayProcess.stdin.write("dismiss\n");
        }
    } catch {
        // Force kill if stdin write fails
        try {
            overlayProcess.kill();
        } catch {
            // ignore
        }
    }

    overlayProcess = null;
}
