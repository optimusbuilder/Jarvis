# About Jarvis: The Voice-First Computer Copilot

## Inspiration
My primary inspiration has always been Iron Man. I was always excited seeing what J.A.R.V.I.S. could do in the movies, and I just wanted to replicate that seamless, hands-free experience as much as possible in real life. 

While voice assistants like Siri exist, there are so many features and deep integrations that they just lack on the desktop. I found myself constantly frustrated having to pull out my phone to take a picture of my laptop screen just so I could ask Gemini or another AI assistant a question about what I was looking at. I wanted an assistant that lives *in* my computer, understands my context perfectly, and can maintain a real, intelligent conversation with me. Furthermore, I wanted something that could genuinely help me search for local files easily and execute real tasks. Overall, my inspiration was just to build something incredibly fun, cool, and actually useful for my daily workflow.

## What it does
Jarvis is a voice-activated, native macOS computer assistant. Instead of typing into a chatbot window, you simply say "Jarvis" out loud, wait for the chime, and speak your command naturally. 

Unlike traditional assistants that just search the web, Jarvis acts as a true OS-level copilot. It can:
*   Listen to your voice and maintain multi-turn, contextual conversations.
*   Flawlessly control native macOS applications, like playing specific songs directly in the Spotify app or scheduling meetings in Apple Calendar.
*   Send text messages directly from your Mac using the native Messages app, complete with intelligent, fuzzy name-matching against your iOS Contacts book.
*   Control system settings (like adjusting the master volume or screen brightness) by writing and executing arbitrary AppleScript strings on the fly.
*   Read and understand text you have highlighted on your screen to answer questions about it.
*   Manage your filesystem (create folders, rename, move, and intelligently search for files).

## How I built it
I architected Jarvis using a split "Brain and Brawn" model to ensure blazing fast local execution while leveraging the massive reasoning power of Google Cloud:

*   **The Desktop Client (The Actuator):** Built with Node.js and TypeScript, this runs locally on macOS. It uses Picovoice Porcupine for offline, privacy-first wake-word detection ("Jarvis"). I use native Apple Speech dictation for incredibly fast Speech-to-Text, and ElevenLabs API for responsive, expressive Text-to-Speech responses. I also wrote custom Swift binaries to render beautiful, native frosted-glass visual overlays when Jarvis speaks.
*   **The Cloud Backend (The Brain):** The core intelligence is hosted on Google Cloud Run. I utilized the Google Vertex AI SDK to power the agent with `gemini-3.1-pro-preview`.
*   **The Bridge:** When you speak, the desktop client sends the transcript to the Cloud Run backend alongside a massive schema of "Tools" (Function Declarations). Gemini processes the request, manages the conversation history, and decides exactly which local macOS tools need to be executed. It sends those instructions back down to the desktop, which triggers native AppleScript and JavaScript for Automation (JXA) scripts to physically control the Mac.

## Challenges I ran into
*   **Architecture Migration:** Migrating the core agent logic from a purely local setup to a stateless Google Cloud Run backend while maintaining the extremely low latency required for natural voice conversations was a significant architectural hurdle.
*   **Mastering macOS Automation:** Writing robust AppleScript and JXA to natively control apps like Calendar and Spotify without forcing the user through clunky OAuth flows took heavy reverse-engineering of macOS application dictionaries. A major issue during development was battling Apple Calendar's exact date formatting requirements to successfully create events via voice.
*   **Contacts Resolution:** When building the iMessage integration, I realized exact-string matching for contacts often failed (e.g., asking to message "Lisa" when her contact is saved as "Lisa Smith"). I had to build a robust two-step pipeline using JavaScript for Automation to do fuzzy-matching against the macOS Contacts database to reliably extract phone numbers first, before dynamically generating the AppleScript payload to send the message.
*   **Session Management:** Building an intelligent, time-to-live (TTL) memory state on the backend so that Jarvis remembers what you said 30 seconds ago, without ballooning memory usage on Cloud Run.

## Accomplishments that I'm proud of
*   **The Architecture Split:** I successfully decoupled the "sensors and actuators" (the microphone, speakers, and macOS scripts) from the "brain" (Gemini on Cloud Run). This means the heavy reasoning happens in the cloud, but the execution happens natively on the metal.
*   **Latency:** The sheer speed of the voice loop. Between local dictation, Cloud Run processing, and ElevenLabs streaming, conversing with Jarvis feels incredibly snappy and natural.
*   **Native Integration:** Getting native macOS apps like Spotify and Calendar to respond flawlessly to voice commands feels like magic compared to typical web-only AI agents. 

## What I learned
*   I took a deep dive into Google Cloud Run deployment and managing authenticated microservices.
*   I mastered the Vertex AI Function Calling (Tools) API, learning how to pass complex schemas to Gemini so it understands exactly what a user's computer is capable of doing.
*   I learned how to bridge modern web technologies (Node.js/TypeScript) with deep, legacy macOS system APIs (Accessibility, Apple Events, JXA).

## What's next for Jarvis
*   **Full Screen Vision:** Moving beyond just reading highlighted text, I plan to integrate Gemini's multimodal vision capabilities so Jarvis can "see" the entire screen seamlessly and understand UI elements visually.
*   **Expanded Toolset:** Deep integrations with native Mail apps, Notes, and smart home controls.
*   **Cross-Platform:** Rewriting the "Actuator" client to support Windows and Linux system APIs so Jarvis can live on any machine.
