import { spawn } from "node:child_process";

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: "inherit" });
  child.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
  return child;
}

const backend = run("npm", ["-w", "backend", "run", "dev"]);
const desktop = run("npm", ["-w", "desktop", "run", "dev"]);

function shutdown() {
  backend.kill("SIGINT");
  desktop.kill("SIGINT");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

