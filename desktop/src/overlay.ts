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
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

let overlayProcess: ChildProcess | null = null;
let contextPanelProcess: ChildProcess | null = null;

function getOverlayBinaryPath(name: "jarvis-overlay" | "jarvis-context-panel"): string {
    const dir = dirname(fileURLToPath(import.meta.url));
    return resolve(dir, "..", "assets", name);
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

    const binaryPath = getOverlayBinaryPath("jarvis-overlay");
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
/**
 * Show the context copilot panel on screen.
 * Automatically dismisses after `dismissAfterSec` seconds,
 * or can be dismissed early with `dismissContextPanel()`.
 */
export function showContextPanel(args: {
    text: string;
    title?: string;
    dismissAfterSec?: number;
}): void {
    dismissContextPanel();

    const binaryPath = getOverlayBinaryPath("jarvis-context-panel");
    if (!existsSync(binaryPath)) {
        console.warn("  ⚠️  Context panel binary not found");
        return;
    }

    const cmdArgs = [
        "--text", args.text,
        "--title", args.title ?? "Jarvis Copilot",
        "--dismiss", String(args.dismissAfterSec ?? 45),
    ];

    contextPanelProcess = spawn(binaryPath, cmdArgs, {
        stdio: ["pipe", "ignore", "ignore"],
        detached: true,
    });

    contextPanelProcess.on("error", (err) => {
        console.warn(`  ⚠️  Context panel error: ${err.message}`);
        contextPanelProcess = null;
    });

    contextPanelProcess.on("exit", () => {
        contextPanelProcess = null;
    });
}

/**
 * Dismiss the currently visible context panel (if any).
 */
export function dismissContextPanel(): void {
    if (!contextPanelProcess) return;

    try {
        if (contextPanelProcess.stdin && !contextPanelProcess.stdin.destroyed) {
            contextPanelProcess.stdin.write("CLOSE\n");
        }
    } catch {
        try {
            contextPanelProcess.kill();
        } catch {
            // ignore
        }
    }

    contextPanelProcess = null;
}
