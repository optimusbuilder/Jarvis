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
        questions: ["I’m not sure what to do. Try: “Open Chrome”, “Open Documents”, or “Go to youtube.com”."],
        tool_calls: []
      };
    }
  };
}

