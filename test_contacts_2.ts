import { execFileAsync } from "./desktop/src/macos.ts";

async function main() {
    console.log("Testing _contains operator in JXA...");
    const script = `
        var app = Application("Contacts");
        var people = app.people.whose({name: {_contains: "Lisa"}})();
        var matches = [];
        for (var i = 0; i < people.length; i++) {
            matches.push(people[i].name());
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
