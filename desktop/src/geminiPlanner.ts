/**
 * Direct Gemini API Planner.
 *
 * Calls the Gemini API directly (no Cloud Run intermediary)
 * to convert a voice transcript into a structured tool-call plan.
 *
 * Falls back to a local heuristic planner for common commands
 * when Gemini is unavailable.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Types ───────────────────────────────────────────
export type ToolCallPlan = {
    name: string;
    args: Record<string, unknown>;
};

export type ActionPlan = {
    goal: string;
    tool_calls: ToolCallPlan[];
    questions: string[];
    spoken_response?: string;
};

// ── System Prompt ───────────────────────────────────
const SYSTEM_PROMPT = `You are AURA, a voice-controlled computer assistant for macOS.
The user speaks commands and you convert them into structured tool calls.

Return ONLY a single JSON object matching this schema:
{
  "goal": "brief description of what you will do",
  "tool_calls": [
    { "name": "tool_name", "args": { ... } }
  ],
  "questions": [],
  "spoken_response": "short confirmation to speak back to the user"
}

Available tools:

SYSTEM TOOLS (macOS):
- open_app(name) — Open an app by name (e.g. "Google Chrome", "Finder", "Safari", "TextEdit")
- open_path(path) — Open a file or folder. Use ~ for home dir (e.g. "~/Documents", "~/Desktop")
- open_url(url) — Open a URL in the default browser (must be a valid URL with https://)
- search_files(query, limit?) — Search for files by name in Desktop/Documents/Downloads
- create_folder(path) — Create a folder (must be within Desktop/Documents/Downloads)
- rename_path(path, new_name) — Rename a file or folder
- move_path(path, destination_dir) — Move a file/folder to another directory
- trash_path(path) — Move to trash (requires confirm_action first)
- confirm_action(reason) — Grant confirmation for destructive actions

ACCESSIBILITY TOOLS (macOS UI automation):
- focus_app(name) — Focus/activate an application window
- click_menu(menu_path, app_name?) — Click a menu item (e.g. ["File", "New Window"])
- type_text(text) — Type text into the focused element
- press_key(keys) — Press key combos (e.g. ["cmd+c"], ["cmd+shift+n"])

BROWSER TOOLS:
- browser_go(url) — Navigate to URL in automation browser
- browser_search(query) — Search on current page
- browser_click_text(text) — Click element containing text
- browser_click_result(index) — Click search result by 1-based index
- browser_extract_text() — Extract visible text from page
- browser_type_active(text) — Type into focused browser element

RULES:
1. For "open Chrome/Safari/etc" → use open_app with the full app name
2. For "open my documents/desktop/downloads" → use open_path with ~/Documents, ~/Desktop, ~/Downloads
3. For "open the Aura folder" → use open_path with the likely path (e.g. ~/Documents/Aura)
4. For web searches → use open_url with a Google search URL: https://www.google.com/search?q=...
5. For "go to youtube.com" → use open_url with the full URL: https://youtube.com
6. spoken_response should be a SHORT natural confirmation (1 sentence max)
7. Never include markdown. Never include explanations outside JSON.
8. If the command is ambiguous, add a question to "questions" instead of guessing.
9. Use multiple tool_calls when the user asks for multiple things.`;

// ── Local Fallback Planner ──────────────────────────

const appNameMap: Record<string, string> = {
    chrome: "Google Chrome",
    safari: "Safari",
    firefox: "Firefox",
    finder: "Finder",
    terminal: "Terminal",
    notes: "Notes",
    textedit: "TextEdit",
    music: "Music",
    spotify: "Spotify",
    slack: "Slack",
    discord: "Discord",
    vscode: "Visual Studio Code",
    "vs code": "Visual Studio Code",
    "visual studio code": "Visual Studio Code",
    code: "Visual Studio Code",
    messages: "Messages",
    mail: "Mail",
    calendar: "Calendar",
    photos: "Photos",
    preview: "Preview",
    settings: "System Settings",
    "system settings": "System Settings",
    "system preferences": "System Settings",
};

const folderMap: Record<string, string> = {
    documents: "~/Documents",
    desktop: "~/Desktop",
    downloads: "~/Downloads",
    home: "~",
    "home folder": "~",
    "home directory": "~",
};

function tryLocalPlan(transcript: string): ActionPlan | null {
    const lower = transcript.toLowerCase().trim();

    // Skip compound commands — route to Gemini for multi-action planning
    if (/\b(and|then|also|plus|after that)\b/.test(lower)) {
        return null;
    }
    const openAppMatch = lower.match(/^(?:open|launch|start)\s+(.+?)(?:\s+app)?$/);
    if (openAppMatch) {
        const target = openAppMatch[1].trim();

        // Check for known folder shortcuts
        for (const [keyword, folderPath] of Object.entries(folderMap)) {
            if (target.includes(keyword)) {
                return {
                    goal: `Open ${keyword} folder`,
                    tool_calls: [{ name: "open_path", args: { path: folderPath } }],
                    questions: [],
                    spoken_response: `Opening your ${keyword} folder.`,
                };
            }
        }

        // Check for known app names
        const resolvedApp = appNameMap[target] ?? appNameMap[target.replace(/\s+/g, " ")];
        if (resolvedApp) {
            return {
                goal: `Open ${resolvedApp}`,
                tool_calls: [{ name: "open_app", args: { name: resolvedApp } }],
                questions: [],
                spoken_response: `Opening ${resolvedApp}.`,
            };
        }

        // Assume it's an app name with proper casing
        const capitalized = target.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        return {
            goal: `Open ${capitalized}`,
            tool_calls: [{ name: "open_app", args: { name: capitalized } }],
            questions: [],
            spoken_response: `Opening ${capitalized}.`,
        };
    }

    // "go to [url]"
    const goToMatch = lower.match(/^(?:go to|navigate to|visit|open)\s+((?:https?:\/\/)?(?:www\.)?[\w.-]+\.\w{2,}(?:\/\S*)?)\s*$/);
    if (goToMatch) {
        let url = goToMatch[1];
        if (!url.startsWith("http")) url = "https://" + url;
        return {
            goal: `Navigate to ${url}`,
            tool_calls: [{ name: "open_url", args: { url } }],
            questions: [],
            spoken_response: `Opening ${url}.`,
        };
    }

    // "search for [query]" / "search [query]" / "google [query]"
    const searchMatch = lower.match(/^(?:search\s+(?:for\s+)?|google\s+|look up\s+)(.+)$/);
    if (searchMatch) {
        const query = searchMatch[1].trim();
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        return {
            goal: `Search for "${query}"`,
            tool_calls: [{ name: "open_url", args: { url } }],
            questions: [],
            spoken_response: `Searching for ${query}.`,
        };
    }

    return null;
}

// ── Gemini API Planner ──────────────────────────────

export async function planWithGemini(args: {
    apiKey: string;
    transcript: string;
    model?: string;
}): Promise<ActionPlan> {
    const modelName = args.model ?? "gemini-2.5-flash";

    // Try local fallback first for simple commands (faster, no API call)
    const localPlan = tryLocalPlan(args.transcript);
    if (localPlan) {
        return localPlan;
    }

    // Call Gemini API
    const genAI = new GoogleGenerativeAI(args.apiKey);
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
        },
        systemInstruction: SYSTEM_PROMPT,
    });

    const result = await model.generateContent(args.transcript);
    const text = result.response.text().trim();

    // Parse JSON response
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`Gemini did not return valid JSON: ${text.slice(0, 200)}`);
    }

    // Validate structure
    const plan = parsed as Record<string, unknown>;
    if (!plan || typeof plan !== "object") {
        throw new Error("Gemini returned non-object JSON");
    }

    const actionPlan: ActionPlan = {
        goal: typeof plan.goal === "string" ? plan.goal : "Execute voice command",
        tool_calls: Array.isArray(plan.tool_calls)
            ? plan.tool_calls.map((call: any) => ({
                name: String(call.name ?? ""),
                args: typeof call.args === "object" && call.args ? call.args : {},
            }))
            : [],
        questions: Array.isArray(plan.questions)
            ? plan.questions.filter((q: unknown): q is string => typeof q === "string")
            : [],
        spoken_response: typeof plan.spoken_response === "string"
            ? plan.spoken_response
            : undefined,
    };

    // Fail-closed: if no tool calls and no questions, something went wrong
    if (actionPlan.tool_calls.length === 0 && actionPlan.questions.length === 0) {
        actionPlan.questions.push("I couldn't determine what to do. Could you rephrase your command?");
    }

    return actionPlan;
}

/**
 * Plan a command — tries local fallback first, then Gemini API.
 * If Gemini is unavailable, returns the local plan or an error.
 */
export async function planCommand(args: {
    transcript: string;
    geminiApiKey?: string;
    model?: string;
}): Promise<ActionPlan> {
    // If no API key, only use local planner
    if (!args.geminiApiKey) {
        const localPlan = tryLocalPlan(args.transcript);
        if (localPlan) return localPlan;
        return {
            goal: "Unable to plan",
            tool_calls: [],
            questions: ["Gemini API key not configured and command is too complex for local planning."],
        };
    }

    try {
        return await planWithGemini({
            apiKey: args.geminiApiKey,
            transcript: args.transcript,
            model: args.model,
        });
    } catch (error) {
        // If Gemini fails, try local fallback
        const localPlan = tryLocalPlan(args.transcript);
        if (localPlan) return localPlan;

        return {
            goal: "Planning failed",
            tool_calls: [],
            questions: [`Planning failed: ${String(error)}`],
        };
    }
}
