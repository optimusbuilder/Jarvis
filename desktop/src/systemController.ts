import os from "node:os";
import path from "node:path";
import { access, lstat, mkdir, readdir, rename, stat } from "node:fs/promises";

export type SearchFilesResult = {
  query: string;
  roots: string[];
  scanned: number;
  truncated: boolean;
  matches: string[];
};

function expandUserPath(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function normalizeAbsolute(input: string): string {
  return path.resolve(expandUserPath(input));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function defaultAllowedRoots(): string[] {
  return uniqueStrings(
    [path.join(os.homedir(), "Desktop"), path.join(os.homedir(), "Documents"), path.join(os.homedir(), "Downloads"), os.tmpdir(), "/tmp"].map(
      normalizeAbsolute
    )
  );
}

function configuredAllowedRoots(): string[] {
  const raw = process.env.AURA_ALLOWED_PATHS;
  if (!raw || !raw.trim()) return defaultAllowedRoots();
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeAbsolute);
  return parsed.length ? uniqueStrings(parsed) : defaultAllowedRoots();
}

function pathWithinRoot(args: { root: string; target: string }): boolean {
  const rel = path.relative(args.root, args.target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolveAllowedPath(input: string): string {
  const target = normalizeAbsolute(input);
  const roots = configuredAllowedRoots();
  const allowed = roots.some((root) => pathWithinRoot({ root, target }));
  if (!allowed) {
    throw new Error(`path_not_allowed:${target}`);
  }
  return target;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(target: string): Promise<void> {
  const info = await stat(target);
  if (!info.isDirectory()) {
    throw new Error(`not_a_directory:${target}`);
  }
}

async function nextAvailableTarget(target: string): Promise<string> {
  if (!(await pathExists(target))) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let index = 1; index <= 999; index += 1) {
    const candidate = path.join(dir, `${base} (${index})${ext}`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("no_available_target_path");
}

function validateName(newName: string): string {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") throw new Error("invalid_new_name");
  if (trimmed.includes("/") || trimmed.includes("\\")) throw new Error("invalid_new_name");
  return trimmed;
}

function readSearchMaxScan(): number {
  const value = Number(process.env.AURA_SEARCH_MAX_SCAN ?? "5000");
  if (!Number.isFinite(value) || value < 100) return 5000;
  return Math.floor(value);
}

export async function searchFiles(args: { query: string; limit: number }): Promise<SearchFilesResult> {
  const query = args.query.trim().toLowerCase();
  if (!query) throw new Error("invalid_query");
  const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.min(Math.floor(args.limit), 50) : 10;
  const roots = configuredAllowedRoots();
  const matches: string[] = [];
  const queue: string[] = roots.slice();
  const visited = new Set<string>();
  const maxScan = readSearchMaxScan();
  let scanned = 0;

  while (queue.length > 0 && scanned < maxScan && matches.length < limit) {
    const dir = queue.shift();
    if (!dir || visited.has(dir)) continue;
    visited.add(dir);

    let entries: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      scanned += 1;
      const fullPath = path.join(dir, entry.name);
      if (entry.name.toLowerCase().includes(query)) {
        matches.push(fullPath);
        if (matches.length >= limit) break;
      }
      if (scanned >= maxScan) break;

      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        queue.push(fullPath);
      }
    }
  }

  return {
    query: args.query,
    roots,
    scanned,
    truncated: scanned >= maxScan,
    matches
  };
}

export async function createFolder(targetPath: string): Promise<{ path: string }> {
  const target = resolveAllowedPath(targetPath);
  await mkdir(target, { recursive: true });
  await ensureDirectory(target);
  return { path: target };
}

export async function renamePath(args: { path: string; newName: string }): Promise<{ from: string; to: string }> {
  const from = resolveAllowedPath(args.path);
  const newName = validateName(args.newName);
  const to = resolveAllowedPath(path.join(path.dirname(from), newName));
  await rename(from, to);
  return { from, to };
}

export async function movePath(args: { path: string; destinationDir: string }): Promise<{ from: string; to: string }> {
  const from = resolveAllowedPath(args.path);
  const destinationDir = resolveAllowedPath(args.destinationDir);
  await ensureDirectory(destinationDir);
  const target = await nextAvailableTarget(path.join(destinationDir, path.basename(from)));
  await rename(from, target);
  return { from, to: target };
}

function trashDirPath(target: string): string {
  const roots = configuredAllowedRoots();
  const root = roots.find((candidate) => pathWithinRoot({ root: candidate, target }));
  if (root) return path.join(root, ".aura-trash");
  return path.join(os.tmpdir(), ".aura-trash");
}

export async function trashPath(targetPath: string): Promise<{ from: string; to: string }> {
  const from = resolveAllowedPath(targetPath);
  const stats = await lstat(from);
  if (stats.isSymbolicLink()) {
    throw new Error(`unsupported_symlink:${from}`);
  }
  const trashDir = trashDirPath(from);
  await mkdir(trashDir, { recursive: true });
  const to = await nextAvailableTarget(path.join(trashDir, path.basename(from)));
  await rename(from, to);
  return { from, to };
}
