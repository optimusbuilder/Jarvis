import type { FunctionDeclaration, Schema } from "@google/generative-ai";
import { SchemaType } from "@google/generative-ai";

export const toolDeclarations: FunctionDeclaration[] = [
    {
        name: "show_context_panel",
        description: "Display text in a beautiful Contextual Copilot popover next to the mouse cursor. Use this ONLY when asked to explain, translate, define, rewrite, or otherwise process the user's [Currently Highlighted Text]. Do not use for generic web searches.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                text: { type: SchemaType.STRING, description: "The answer, explanation, or rewritten text to display. (You can also use 'content' for this)" },
                title: { type: SchemaType.STRING, description: "Optional title, like 'Definition' or 'Rewrite'." },
                content: { type: SchemaType.STRING, description: "The answer, explanation, or rewritten text to display." }
            }
        }
    },
    {
        name: "open_app",
        description: "Open a macOS application by name.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["name"],
            properties: { name: { type: SchemaType.STRING } }
        }
    },
    {
        name: "open_path",
        description: "Open a file or folder path.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["path"],
            properties: { path: { type: SchemaType.STRING } }
        }
    },
    {
        name: "open_url",
        description: "Open a URL in the default browser.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["url"],
            properties: { url: { type: SchemaType.STRING } }
        }
    },
    {
        name: "play_spotify",
        description: "Search for a song and flawlessly play it natively on Spotify.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["song"],
            properties: {
                song: { type: SchemaType.STRING },
                artist: { type: SchemaType.STRING }
            }
        }
    },
    {
        name: "search_files",
        description: "Search allowed filesystem roots for names matching a query.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["query"],
            properties: {
                query: { type: SchemaType.STRING },
                limit: { type: SchemaType.INTEGER }
            }
        }
    },
    {
        name: "create_folder",
        description: "Create a folder path inside allowed filesystem roots.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["path"],
            properties: { path: { type: SchemaType.STRING } }
        }
    },
    {
        name: "rename_path",
        description: "Rename a file or folder by new basename.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["path", "new_name"],
            properties: {
                path: { type: SchemaType.STRING },
                new_name: { type: SchemaType.STRING }
            }
        }
    },
    {
        name: "move_path",
        description: "Move a file/folder into a destination directory.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["path", "destination_dir"],
            properties: {
                path: { type: SchemaType.STRING },
                destination_dir: { type: SchemaType.STRING }
            }
        }
    },
    {
        name: "trash_path",
        description: "Move a file/folder to trash. Requires confirm_action first.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["path"],
            properties: { path: { type: SchemaType.STRING } }
        }
    },
    {
        name: "confirm_action",
        description: "Grant one-time confirmation for the next destructive action.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["reason"],
            properties: { reason: { type: SchemaType.STRING } }
        }
    },
    {
        name: "web_search",
        description: "Search the web for real-time information, news, current events, weather, or facts. Returns a summarized answer.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["query"],
            properties: { query: { type: SchemaType.STRING } }
        }
    },
    {
        name: "add_calendar_event",
        description: "Add a new event to the macOS Calendar app. Requires standard ISO-8601 date strings for start and end times in the user's local timezone.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["title", "start_date_iso", "end_date_iso"],
            properties: {
                title: { type: SchemaType.STRING },
                start_date_iso: { type: SchemaType.STRING },
                end_date_iso: { type: SchemaType.STRING },
                notes: { type: SchemaType.STRING }
            }
        }
    },
    {
        name: "focus_app",
        description: "Focus an application via macOS Accessibility APIs.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["name"],
            properties: { name: { type: SchemaType.STRING } }
        }
    },
    {
        name: "click_menu",
        description: "Click a menu item path in the focused app (e.g. [\"Edit\", \"Copy\"]).",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["menu_path"],
            properties: {
                menu_path: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING } as Schema
                },
                app_name: { type: SchemaType.STRING }
            }
        }
    },
    {
        name: "type_text",
        description: "Type text into the currently focused UI element via Accessibility.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["text"],
            properties: { text: { type: SchemaType.STRING } }
        }
    },
    {
        name: "press_key",
        description: "Press one or more key chords via Accessibility (e.g. [\"cmd+c\"]).",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["keys"],
            properties: {
                keys: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING } as Schema
                }
            }
        }
    },
    {
        name: "wait_ms",
        description: "Wait for a bounded duration in milliseconds.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["ms"],
            properties: { ms: { type: SchemaType.INTEGER } }
        }
    },
    {
        name: "browser_new_tab",
        description: "Open a new browser tab in the automation controller.",
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },
    {
        name: "browser_go",
        description: "Navigate active automation tab to a URL and verify page readiness.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["url"],
            properties: { url: { type: SchemaType.STRING } }
        }
    },
    {
        name: "browser_search",
        description: "Submit a search query in the current page context.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["query"],
            properties: { query: { type: SchemaType.STRING } }
        }
    },
    {
        name: "browser_click_result",
        description: "Click a search result link by 1-based index.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["index"],
            properties: { index: { type: SchemaType.INTEGER } }
        }
    },
    {
        name: "browser_extract_text",
        description: "Extract visible text from current page with verification summary.",
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },
    {
        name: "browser_click_text",
        description: "Click the first clickable element containing the provided text.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["text"],
            properties: { text: { type: SchemaType.STRING } }
        }
    },
    {
        name: "browser_type_active",
        description: "Type text into the currently focused element in automation context.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["text"],
            properties: { text: { type: SchemaType.STRING } }
        }
    },
    {
        name: "find_and_open",
        description: "Search for a file or folder by name and open the best match. Use when user references a specific file/folder name.",
        parameters: {
            type: SchemaType.OBJECT,
            required: ["query"],
            properties: {
                query: { type: SchemaType.STRING },
                root: { type: SchemaType.STRING, description: "Optional subfolder to search within, e.g. 'Documents'" }
            }
        }
    }
];
