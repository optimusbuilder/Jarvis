import { execFileAsync } from "./desktop/src/macos.ts";

async function main() {
    const contactName = "Moyin";
    // 1. Look up the phone number robustly using JXA
    const lookupScript = `
        var app = Application("Contacts");
        var allPeople = app.people();
        var targetName = "";
        var targetNumber = "";
        
        // Manual substring search to avoid JXA 'whose' clause bugs
        for (var i = 0; i < allPeople.length; i++) {
            var person = allPeople[i];
            var name = person.name();
            if (name && name.toLowerCase().indexOf("${contactName.toLowerCase()}") !== -1) {
                targetName = name;
                var phones = person.phones();
                if (phones.length > 0) {
                    targetNumber = phones[0].value();
                    break;
                }
            }
        }
        
        if (!targetNumber) {
            throw new Error("Could not find any contact matching '${contactName}' with a saved phone number.");
        }
        
        JSON.stringify({name: targetName, number: targetNumber});
    `;

    try {
        const { stdout: lookupOut, stderr: lookupErr } = await require('child_process').execFile("osascript", ["-l", "JavaScript", "-e", lookupScript], (err: any, stdout: string, stderr: string) => {
            console.log("STDOUT:", stdout);
            if (stderr) console.log("STDERR:", stderr);
        });
    } catch (e: any) {
        console.error("Exec error:", e.message);
    }
}
main().catch(console.error);
