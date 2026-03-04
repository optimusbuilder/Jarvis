import type { VertexPlanner } from "./vertex.js";

function normalize(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLowerCase();
}

function looksLikeUrl(text: string): boolean {
  if (text.startsWith("http://") || text.startsWith("https://")) return true;
  if (text.includes(" ") || text.length < 4) return false;
  return /^[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(text);
}

function toUrl(text: string): string {
  if (text.startsWith("http://") || text.startsWith("https://")) return text;
  return `https://${text}`;
}

function toGoogleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
}

const appAliases: Record<string, string> = {
  chrome: "Google Chrome",
  "google chrome": "Google Chrome",
  safari: "Safari",
  finder: "Finder",
  terminal: "Terminal",
  notes: "Notes",
  textedit: "TextEdit"
};

const pathAliases: Record<string, string> = {
  documents: "~/Documents",
  downloads: "~/Downloads",
  desktop: "~/Desktop"
};

export function createLocalPlanner(): VertexPlanner {
  return {
    async plan({ instruction }) {
      const text = normalize(instruction);
      const lower = text; // normalized text is already lowercased and trimmed

      // ── Vision bypass ──
      const isScreenQuery = /\b(on my screen|see my screen|looking at|read this|summarize this|what is this|what's this|click|tap|select|type)\b/.test(lower);
      if (isScreenQuery) {
        return null; // Force LLM
      }

      // ── Question detection → route to web_search (skip LLM!) ──
      const questionPatterns = [
        /^(?:what|who|when|where|why|how)\b/,
        /^(?:what's|who's|when's|where's|how's|what're|who're)\b/,
        /^(?:is|are|was|were|do|does|did|can|could|will|would|should|has|have|had)\b.+\?*$/,
        /^(?:tell me|tell us)\b/,
        /^(?:explain|describe|define)\b/,
        /\b(?:current price|price of|cost of|weather in|weather at|score of|temperature)\b/,
      ];

      if (questionPatterns.some(p => p.test(lower))) {
        const query = text.replace(/[?.!]+$/g, "").trim();
        return {
          goal: `Web search: ${query}`,
          tool_calls: [{ name: "web_search", args: { query } }],
          questions: []
        };
      }

      // open chrome and search <query>
      const openChromeSearchMatch = text.match(
        /^(open|launch|start)\s+(google chrome|chrome)\s+(and|&)\s+(search|google)\s+(for\s+)?(.+)$/
      );
      if (openChromeSearchMatch) {
        const query = openChromeSearchMatch[6]?.trim();
        if (query) {
          return {
            goal: `Open Google Chrome and search for ${query}`,
            questions: [],
            tool_calls: [
              { name: "open_app", args: { name: "Google Chrome" } },
              { name: "open_url", args: { url: toGoogleSearchUrl(query) } }
            ]
          };
        }
      }

      // search <query>
      const searchMatch = text.match(/^(search|google)(\s+for)?\s+(.+)$/);
      if (searchMatch) {
        const query = searchMatch[3]?.trim();
        if (query) {
          return {
            goal: `Search for ${query}`,
            questions: [],
            tool_calls: [{ name: "open_url", args: { url: toGoogleSearchUrl(query) } }]
          };
        }
      }

      // open <thing>
      const openMatch = text.match(/^(open|launch|start)\s+(.+)$/);
      if (openMatch) {
        const target = openMatch[2].trim();
        const appName = appAliases[target];
        if (appName) {
          return { goal: `Open ${appName}`, questions: [], tool_calls: [{ name: "open_app", args: { name: appName } }] };
        }

        const path = pathAliases[target];
        if (path) {
          return { goal: `Open ${target}`, questions: [], tool_calls: [{ name: "open_path", args: { path } }] };
        }

        if (looksLikeUrl(target)) {
          return { goal: `Open ${target}`, questions: [], tool_calls: [{ name: "open_url", args: { url: toUrl(target) } }] };
        }

        return {
          goal: "Clarify open target",
          questions: [`Do you want to open an app, a folder, or a website named “${target}”?`],
          tool_calls: []
        };
      }

      // go to <url>
      const goMatch = text.match(/^(go to|navigate to)\s+(.+)$/);
      if (goMatch) {
        const target = goMatch[2].trim();
        if (looksLikeUrl(target)) {
          return { goal: `Go to ${target}`, questions: [], tool_calls: [{ name: "open_url", args: { url: toUrl(target) } }] };
        }
        return { goal: "Clarify URL", questions: [`What website should I navigate to?`], tool_calls: [] };
      }

      return {
        goal: "Clarify request",
        questions: ["I’m not sure what to do. Try: “Open Chrome”, “Search for whisper cpp”, or “Go to youtube.com”."],
        tool_calls: []
      };
    }
  };
}
