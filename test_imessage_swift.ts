import { sendIMessage } from "./desktop/src/macos";

async function main() {
    try {
        const result = await sendIMessage("Lisa", "Swift integrated test message.");
        console.log("SUCCESS:", result);
    } catch (e: any) {
        console.error("ERROR:", e.message);
    }
}

main().catch(console.error);
