import { execFileAsync } from "./desktop/src/macos.ts";

async function main() {
    try {
        console.log("Sending...");
        const script = `tell application "Messages" to send "Test" to participant "Moyin"`;
        const { stdout, stderr } = await require('child_process').execFile("osascript", ["-e", script], (err: any, out: string, errOut: string) => {
            console.log("STDOUT:", out);
            if (errOut) console.log("STDERR:", errOut);
        });
    } catch (e: any) {
        console.error("Exec error:", e.message);
    }
}
main();
