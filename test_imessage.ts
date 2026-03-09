import { execFileAsync } from "./desktop/src/macos.ts";

async function main() {
    const name = "Moua Ogunjobi";
    const message = "This is a test from Jarvis using Contacts lookup";

    // Hardened AppleScript that first looks up the phone number in Contacts
    const script = `
        var app = Application("Contacts");
        var people = app.people.whose({name: "${name}"})();
        
        if (people.length === 0) {
            throw new Error("Could not find contact named '${name}'");
        }
        
        var person = people[0];
        if (person.phones().length === 0) {
            throw new Error("Contact '${name}' has no phone numbers saved");
        }
        
        // Grab the first phone number
        var targetNumber = person.phones()[0].value();
        
        var messagesApp = Application("Messages");
        var targetService = messagesApp.services.whose({serviceType: "iMessage"})()[0];
        
        try {
            var targetBuddy = messagesApp.Buddy(targetNumber);
            messagesApp.send("${message}", {to: targetBuddy});
            console.log("Sent successfully to " + targetNumber);
        } catch (e) {
            throw new Error("Failed to send message via iMessage: " + e.message);
        }
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
