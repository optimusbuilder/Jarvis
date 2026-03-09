async function main() {
    const script = `
        var messagesApp = Application("Messages");
        var serviceNames = [];
        var svcs = messagesApp.services();
        for (var i = 0; i < svcs.length; i++) {
            serviceNames.push(svcs[i].name() + " (" + svcs[i].serviceType() + ")");
        }
        JSON.stringify(serviceNames);
    `;
    try {
        require('child_process').execFile("osascript", ["-l", "JavaScript", "-e", script], (err: any, stdout: any, stderr: any) => {
            console.log("STDOUT:", stdout);
            if (stderr) console.log("STDERR:", stderr);
        });
    } catch (e) { }
}
main();
