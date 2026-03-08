# Jarvis Voice Agent

Jarvis is a voice-first, native macOS computer assistant. It listens for a wake word, intelligently processes your requests via Google Cloud, and executes actions directly on your local machine using native macOS APIs.

Unlike typical chatbots, Jarvis acts as a true OS-level copilot—it can play music on your local Spotify app, schedule meetings in your Apple Calendar, adjust system settings, manage files, and control your browser.

## Architecture

The project is split into a **Thin Desktop Client** and a **Cloud Agent Brain** to meet hackathon requirements for cloud execution while preserving local machine control.

### 1. Cloud Run Backend (The "Brain")
*   **Hosted on:** Google Cloud Run.
*   **LLM Engine:** Vertex AI (`gemini-2.5-flash`).
*   **Functionality:** Maintains session memory, handles multi-turn conversations, parses user transcripts, and intelligently decides which native tools the desktop client needs to execute (via `FunctionDeclarations`).
*   **Security:** Enforces authenticated endpoints and structured schema validation.

### 2. Desktop Client (The "Actuator")
*   **Running on:** macOS (Node.js/TypeScript).
*   **Wake Word:** Picovoice Porcupine (listening for "Jarvis").
*   **Speech-to-Text (STT):** Native Apple Speech (`dictation`) for fast, local transcription.
*   **Text-to-Speech (TTS):** ElevenLabs API for high-quality, expressive voice responses.
*   **Execution UI:** Custom macOS native frosted-glass Swift overlays (`jarvis-overlay` and `jarvis-context-panel`).

## Native Capabilities (Tools)

Jarvis bridges the LLM with your computer using native macOS automation (JavaScript for Automation/JXA, AppleScript, and OS APIs):

*   **Spotify Control:** Can search for tracks and intelligently play them in the native macOS Spotify app without requiring the Spotify API.
*   **Apple Calendar:** Creates events directly in your system Calendar via JXA.
*   **System Volume:** Adjusts the OS master volume via AppleScript.
*   **Filesystem Management:** Can create folders, rename files, move items, trash files, and search using `mdfind` (Spotlight).
*   **Browser Automation:** Can open URLs, search the web, and interact with the active browser.
*   **Accessibility & UI:** Can focus apps, click macOS menu bar items, type text into the active window, and press keyboard shortcuts.

## Getting Started

### Prerequisites
*   macOS (Intel or Apple Silicon).
*   Node.js (v20+ recommended).
*   A Google Cloud Project with Vertex AI and Cloud Run enabled.
*   An ElevenLabs API Key.

### 1. Backend Setup (Google Cloud)
1. Deploy the `backend` directory to Google Cloud Run:
   ```bash
   gcloud run deploy jarvis-backend --source backend --region us-central1 --allow-unauthenticated
   ```
2. Set the required backend environment variables in Cloud Run:
   *   `GOOGLE_CLOUD_PROJECT`
   *   `AURA_GEMINI_MODEL` (e.g., `gemini-2.5-flash`)
   *   `AURA_BACKEND_AUTH_TOKEN` (Create a secure token for client auth).

### 2. Desktop Setup (Local macOS)
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Configure your desktop `.env` file (see `.env.example` if applicable, or create one in the root):
   ```env
   ELEVENLABS_API_KEY=your_elevenlabs_key
   ELEVENLABS_VOICE_ID=your_voice_id
   
   AURA_BACKEND_URL=https://your-cloud-run-url.run.app
   AURA_BACKEND_AUTH_TOKEN=the_secure_token_from_backend
   
   # Note: GEMINI_API_KEY is not needed locally because the brain is in the cloud.
   ```
3. (Optional) Recompile the Swift UI overlays if you make UI changes:
   ```bash
   swiftc desktop/src/swift/JarvisOverlay.swift -o desktop/assets/jarvis-overlay
   ```

## 🎙️ Running Jarvis
Start the voice agent:

```bash
npm -w desktop run voice
```

1. Wait for the `🌟 Jarvis Voice Agent` boot sequence to finish.
2. Say the wake word: **"Jarvis"**.
3. You will hear an activation chime. Speak your command (e.g., *"Set a meeting for tomorrow at 2 PM"* or *"Play some jazz on Spotify"*).
4. Jarvis will pause, transcribe, think via Cloud Run, execute the action locally, and respond with a voice confirmation and visual overlay.

##  Safety & Privacy
*   **Push-to-Talk / Wake Word:** Jarvis only records audio when explicitly summoned. Audio recording stops automatically when you stop speaking.
*   **Cloud Isolation:** The Cloud Run backend receives only text transcripts, not raw audio or sensitive local files.
*   **Destructive Actions:** Actions like trashing files or moving data require explicit confirmation.

---
*Built for the Google Cloud Vertex AI Hackathon.*
