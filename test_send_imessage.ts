import { sendIMessage } from "./desktop/src/macos";

async function main() {
    try {
        console.log("Calling sendIMessage with 'Lisa'...");
        const result = await sendIMessage("Lisa", "This is a brief test to verify the updated Jarvis Contact matching.");
        console.log("SUCCESS:", result);
    } catch (e: any) {
        console.error("ERROR:", e.message);
    }
}
main().catch(console.error);
