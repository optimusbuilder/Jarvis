import { sendIMessage } from "./desktop/src/macos";

async function main() {
    try {
        const result = await sendIMessage("Lisa", "Testing the enforced iMessage buddy route.");
        console.log("SUCCESS:", result);
    } catch (e: any) {
        console.error("ERROR:", e.message);
    }
}
main().catch(console.error);
