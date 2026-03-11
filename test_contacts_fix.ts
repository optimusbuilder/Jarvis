import { execFileAsync } from "./desktop/src/macos.ts";

async function main() {
    console.log("Testing JXA Contacts fix...");
    const script = `
        var app = Application("Contacts");
        var allPeople = app.people();
        
        var matches = [];
        for (var i = 0; i < allPeople.length; i++) {
            var name = allPeople[i].name() || "";
            if (name === "Lisa" || name.toLowerCase().indexOf("lisa") !== -1 || name === "Moni" || name.toLowerCase().indexOf("moyin") !== -1) {
                matches.push({name: name, phones: allPeople[i].phones().map(p => p.value())});
            }
        }
        JSON.stringify(matches);
    `;

    try {
        const { stdout, stderr } = await require('child_process').execFile("osascript", ["-l", "JavaScript", "-e", script], (err, stdout, stderr) => {
            console.log("STDOUT:", stdout);
            if (stderr) console.log("STDERR:", stderr);
        });
    } catch (e) {
        console.error("Exec error:", e);
    }
}
main().catch(console.error);
