import { execFileAsync } from "./desktop/src/macos.ts";

async function main() {
    console.log("Testing Apple Calendar event creation via JXA...");

    const title = "Hackathon Sync";
    const startDateIso = "2026-03-09T15:00:00Z";
    const endDateIso = "2026-03-09T16:00:00Z";
    const notes = "Testing Jarvis Calendar integration";

    const script = `
        var app = Application('Calendar');
        var title = ${JSON.stringify(title)};
        var start = new Date(${JSON.stringify(startDateIso)});
        var end = new Date(${JSON.stringify(endDateIso)});
        var notes = ${JSON.stringify(notes)};
        
        var cals = app.calendars;
        if (cals.length === 0) throw new Error("No calendars found");
        var targetCal = null;
        for (var i = 0; i < cals.length; i++) {
            var c = cals[i];
            if (c.name() === "Home" || c.name() === "Calendar" || c.name() === "Work") {
                targetCal = c;
                break;
            }
        }
        if (!targetCal) targetCal = cals[0];

        var newEvent = app.Event({
            summary: title,
            startDate: start,
            endDate: end,
            description: notes
        });
        
        try {
            app.calendars.byName(targetCal.name()).events.push(newEvent);
            console.log("Success! Event added to " + targetCal.name());
        } catch (e) {
            console.log("ERROR PUSHING EVENT: " + e.message);
        }
        targetCal.name();
    `;

    try {
        const { stdout, stderr } = await require('child_process').execFile("osascript", ["-l", "JavaScript", "-e", script], (err, stdout, stderr) => {
            console.log("STDOUT:", stdout);
            console.log("STDERR:", stderr);
            console.log("ERR:", err?.message);
        });
    } catch (e) {
        console.error("Exec error:", e);
    }
}
main().catch(console.error);
