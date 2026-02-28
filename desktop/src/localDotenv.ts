import fs from "node:fs";
import path from "node:path";

function parseLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;

  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const idx = withoutExport.indexOf("=");
  if (idx <= 0) return null;

  const key = withoutExport.slice(0, idx).trim();
  let value = withoutExport.slice(idx + 1).trim();

  if (!key) return null;

  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

export function loadLocalDotenv(): void {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "..", ".env")
  ];

  const dotenvPath = candidates.find((p) => fs.existsSync(p));
  if (!dotenvPath) return;

  const content = fs.readFileSync(dotenvPath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

