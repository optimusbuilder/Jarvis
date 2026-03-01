import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createFolder,
  movePath,
  renamePath,
  resolveAllowedPath,
  searchFiles,
  trashPath
} from "../src/systemController.js";

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

describe("systemController", () => {
  it("enforces allowed roots", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "aura-p7-root-"));
    const previousAllowedPaths = process.env.AURA_ALLOWED_PATHS;
    process.env.AURA_ALLOWED_PATHS = tmpRoot;
    try {
      const safe = resolveAllowedPath(path.join(tmpRoot, "safe"));
      expect(safe.startsWith(tmpRoot)).toBe(true);
      expect(() => resolveAllowedPath("/etc/hosts")).toThrow(/path_not_allowed/);
    } finally {
      if (previousAllowedPaths === undefined) delete process.env.AURA_ALLOWED_PATHS;
      else process.env.AURA_ALLOWED_PATHS = previousAllowedPaths;
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("supports create, rename, move, search, trash workflow", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "aura-p7-ops-"));
    const previousAllowedPaths = process.env.AURA_ALLOWED_PATHS;
    process.env.AURA_ALLOWED_PATHS = tmpRoot;
    try {
      const source = path.join(tmpRoot, "source");
      const destination = path.join(tmpRoot, "destination");
      await createFolder(source);
      await createFolder(destination);

      const original = path.join(source, "alpha-note.txt");
      await writeFile(original, "phase7");

      const renamed = await renamePath({ path: original, newName: "beta-note.txt" });
      expect(await pathExists(renamed.to)).toBe(true);

      const moved = await movePath({ path: renamed.to, destinationDir: destination });
      expect(await pathExists(moved.to)).toBe(true);

      const search = await searchFiles({ query: "beta-note", limit: 5 });
      expect(search.matches.some((item) => item === moved.to)).toBe(true);

      const trashed = await trashPath(moved.to);
      expect(await pathExists(trashed.to)).toBe(true);
      expect(await pathExists(moved.to)).toBe(false);
    } finally {
      if (previousAllowedPaths === undefined) delete process.env.AURA_ALLOWED_PATHS;
      else process.env.AURA_ALLOWED_PATHS = previousAllowedPaths;
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
