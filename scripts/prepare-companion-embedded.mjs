#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, rm } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const backendDist = path.join(repoRoot, "backend", "dist");
const desktopDist = path.join(repoRoot, "desktop", "dist");
const embeddedRoot = path.join(repoRoot, "companion", "embedded");
const embeddedBackend = path.join(embeddedRoot, "backend-dist");
const embeddedDesktop = path.join(embeddedRoot, "desktop-dist");

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: process.env
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} failed with code ${code ?? "null"}`));
    });
  });
}

async function prepare() {
  console.log("Building backend + desktop runtime...");
  await run(npmCommand(), ["-w", "backend", "run", "build"], repoRoot);
  await run(npmCommand(), ["-w", "desktop", "run", "build"], repoRoot);

  console.log("Preparing companion embedded runtime...");
  await mkdir(embeddedRoot, { recursive: true });
  await rm(embeddedBackend, { recursive: true, force: true });
  await rm(embeddedDesktop, { recursive: true, force: true });

  await cp(backendDist, embeddedBackend, { recursive: true });
  await cp(desktopDist, embeddedDesktop, { recursive: true });

  console.log("Embedded runtime ready:");
  console.log(`- ${embeddedBackend}`);
  console.log(`- ${embeddedDesktop}`);
}

prepare().catch((error) => {
  console.error(`❌ prepare-companion-embedded failed: ${String(error)}`);
  process.exit(1);
});

