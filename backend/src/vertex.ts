import type { Env } from "./env.js";
import { actionPlanSchema } from "./schemas.js";
import { logError, logInfo } from "./logging.js";

export interface VertexPlanner {
  plan(args: {
    instruction: string;
    context?: unknown;
    state?: unknown;
    request_id?: string;
  }): Promise<unknown>;
}

type MetadataTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

async function getAccessToken(): Promise<string> {
  // Cloud Run (and most GCP runtimes) expose an access token via the metadata server.
  const url =
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
  const res = await fetch(url, {
    headers: { "metadata-flavor": "Google" }
  });
  if (!res.ok) {
    throw new Error(`metadata token fetch failed: ${res.status}`);
  }
  const json = (await res.json()) as MetadataTokenResponse;
  if (!json?.access_token) {
    throw new Error("metadata token response missing access_token");
  }
  return json.access_token;
}

function vertexBaseUrl(location: string): string {
  if (location === "global") return "https://aiplatform.googleapis.com";
  return `https://${location}-aiplatform.googleapis.com`;
}

function vertexGenerateContentUrl(args: { project: string; location: string; model: string }): string {
  const base = vertexBaseUrl(args.location);
  const encodedModel = encodeURIComponent(args.model);
  return (
    `${base}/v1/projects/${encodeURIComponent(args.project)}` +
    `/locations/${encodeURIComponent(args.location)}` +
    `/publishers/google/models/${encodedModel}:generateContent`
  );
}

type VertexGenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

export function createVertexPlanner(env: Env): VertexPlanner {
  if (!env.GOOGLE_CLOUD_PROJECT || !env.AURA_GEMINI_MODEL) {
    throw new Error("Vertex planner requires GOOGLE_CLOUD_PROJECT and AURA_GEMINI_MODEL");
  }
  const project = env.GOOGLE_CLOUD_PROJECT;
  const model = env.AURA_GEMINI_MODEL;

  return {
    async plan({ instruction, context, state, request_id }) {
      const startedAt = Date.now();
      logInfo("vertex_plan_start", {
        request_id: request_id ?? null,
        model,
        location: env.GOOGLE_CLOUD_LOCATION,
        instruction_chars: instruction.length,
        has_context: context != null,
        has_state: state != null
      });

      const system = `You are Jarvis, a voice-controlled computer assistant for macOS.
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
- find_and_open(query, root?) — Search for a file/folder by name and open the best match. "root" is optional (e.g. "Documents")
- web_search(query) — Search the internet using Tavily. Use for real-time info: prices, news, weather, sports, current events, facts you're unsure about

ACCESSIBILITY TOOLS (macOS UI automation):
- focus_app(name) — Focus/activate an application window
- click_menu(menu_path, app_name?) — Click a menu item (e.g. ["File", "New Window"])
- type_text(text) — Type text into the focused element
- press_key(keys) — Press key combos (e.g. ["cmd+c"], ["cmd+shift+n"])

MACOS CONTROL:
- execute_applescript(script) — Executes AppleScript on the user's Mac to control applications, system settings (volume, brightness), media playback, or open apps. Use this for ANY system control request like "turn up volume", "mute", "play music", "open Spotify".
- click_element(description) — Visually locate and click an OS-level button, icon, or text on the screen. \`description\` should be exactly what it looks like (e.g. "Safari icon in dock", "Login button", "the red submit button").

BROWSER TOOLS:
- browser_go(url) — Navigate to URL in automation browser
- browser_search(query) — Search on current page
- browser_click_text(text) — Click element containing text
- browser_click_result(index) — Click search result by 1-based index
- browser_extract_text() — Extract visible text from page
- browser_type_active(text) — Type into focused browser element

RULES:
1. open_app is ONLY for well-known macOS applications (Safari, Chrome, Finder, Notes, etc). NEVER use open_app for files or folders.
2. For "open my documents/desktop/downloads" → use open_path with ~/Documents, ~/Desktop, ~/Downloads
3. For web searches → use open_url with a Google search URL: https://www.google.com/search?q=...
4. For "go to youtube.com" → use open_url with the full URL: https://youtube.com
5. spoken_response should be natural and conversational. For action commands, keep it short (1 sentence). For questions, provide a helpful answer (2-4 sentences max).
6. Never include markdown. Never include explanations outside JSON.
7. If the command is ambiguous, add a question to "questions" instead of guessing.
8. Use multiple tool_calls when the user asks for multiple things.
9. CRITICAL: When the user mentions a SPECIFIC file, folder, or document by name, ALWAYS use find_and_open to search for it.
   - "open the Medical Report Analyzer in my documents" → find_and_open(query="Medical Report Analyzer", root="Documents")
   - "open the readme file" → find_and_open(query="readme")
   - "open my budget spreadsheet" → find_and_open(query="budget")
   - "open the 2 Sigma cheat sheets in downloads" → find_and_open(query="2 Sigma cheat sheets", root="Downloads")
10. Only use open_path with ~ tilde paths for the TOP-LEVEL well-known folders: ~/Documents, ~/Desktop, ~/Downloads.
11. QUESTIONS & CONVERSATION: If the user asks a question:
    - For REAL-TIME info (prices, news, weather, scores, current events) → use web_search(query) tool and set spoken_response to summarize the results.
      Examples:
      - "What's the price of bitcoin?" → web_search(query="current price of bitcoin"), spoken_response: "Let me look that up for you."
      - "What's the weather in New York?" → web_search(query="weather in New York today")
      - "Who won the Super Bowl?" → web_search(query="Super Bowl winner 2026")
    - For GENERAL KNOWLEDGE (definitions, how-to, opinions, jokes) → answer directly in spoken_response with empty tool_calls.
      Examples:
      - "Tell me a joke" → empty tool_calls, spoken_response: (a joke)
      - "What is photosynthesis?" → empty tool_calls, spoken_response: (explanation)
    Use your knowledge to answer factual questions. For anything time-sensitive or you're unsure about, use web_search.
    12. CONTEXT-AWARE VISION: If an image is attached to your prompt, it is a SCREENSHOT of the user's current display.
        - You MUST analyze the image if the user asks "what am I looking at?", "read this", "summarize my screen", etc.
        - Describe what you see accurately and concisely in the spoken_response.`;

      const payload = JSON.stringify(
        { instruction, desktop_state: state ?? null, context_snapshot: context ?? null },
        null,
        2
      );

      const token = await getAccessToken();
      const url = vertexGenerateContentUrl({
        project,
        location: env.GOOGLE_CLOUD_LOCATION,
        model
      });

      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: system + "\n\n" + payload }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: "application/json"
          }
        })
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logError("vertex_plan_http_error", {
          request_id: request_id ?? null,
          status: res.status,
          duration_ms: Date.now() - startedAt
        });
        throw new Error(`Vertex generateContent failed: ${res.status} ${body}`);
      }

      const json = (await res.json()) as VertexGenerateContentResponse;
      const text =
        json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("")?.trim() ?? "";

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        logError("vertex_plan_parse_error", {
          request_id: request_id ?? null,
          duration_ms: Date.now() - startedAt
        });
        throw new Error("Model did not return valid JSON");
      }

      const validated = actionPlanSchema.safeParse(parsed);
      if (!validated.success) {
        logError("vertex_plan_schema_error", {
          request_id: request_id ?? null,
          duration_ms: Date.now() - startedAt
        });
        throw new Error("Model JSON did not match action plan schema");
      }

      logInfo("vertex_plan_success", {
        request_id: request_id ?? null,
        duration_ms: Date.now() - startedAt,
        tool_calls: validated.data.tool_calls.length,
        questions: validated.data.questions.length
      });

      return validated.data;
    }
  };
}
