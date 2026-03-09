import { addCalendarEvent } from "./desktop/src/macos";

async function main() {
    try {
        console.log("Calling addCalendarEvent directly...");
        // valid dates
        const result1 = await addCalendarEvent("Test Event 1", "2026-03-09T17:00:00Z", "2026-03-09T18:00:00Z", "");
        console.log("Result 1:", result1);

        // what if we pass something invalid?
        const result2 = await addCalendarEvent("Test Event 2", "bad-date", "worse-date", "");
        console.log("Result 2:", result2);
    } catch (e: any) {
        console.error("Error caught:", e.message);
    }
}
main().catch(console.error);
