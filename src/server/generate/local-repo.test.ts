import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getLocalRepositoryData,
  isLocalRepository,
  listLocalRepositories,
  readLocalSource,
  resolveLocalRepository,
} from "~/server/generate/local-repo";

// <root>/demo is a plain folder (no git), so the directory walk is used.
const root = mkdtempSync(path.join(tmpdir(), "gitdiagram-repos-"));
const demo = path.join(root, "demo");
for (const [file, text] of Object.entries({
  "README.md": "# Demo\n",
  "src/main.ts": "import { util } from './util';\n",
  "src/util.ts": "export const util = 1;\n",
  "node_modules/dep/index.js": "ignored",
  "build/out.js": "ignored",
  "assets/logo.png": "ignored",
})) {
  mkdirSync(path.dirname(path.join(demo, file)), { recursive: true });
  writeFileSync(path.join(demo, file), text);
}
writeFileSync(path.join(demo, "src/blob.bin"), Buffer.from([1, 0, 2]));

beforeEach(() => {
  vi.stubEnv("GITDIAGRAM_LOCAL", "1");
  vi.stubEnv("LOCAL_REPO_ROOTS", root);
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("local repositories", () => {
  it("are only the local owner in local mode", () => {
    expect(isLocalRepository("local")).toBe(true);
    vi.stubEnv("GITDIAGRAM_LOCAL", "");
    expect(isLocalRepository("local")).toBe(false);
  });

  it("resolve to direct sub-folders of the roots, nothing else", async () => {
    expect(await resolveLocalRepository("demo")).toBe(demo);
    expect(await resolveLocalRepository("..")).toBeNull();
    expect(await resolveLocalRepository("demo/src")).toBeNull();
    expect(await resolveLocalRepository("missing")).toBeNull();
    expect(await listLocalRepositories()).toEqual([
      { name: "demo", path: demo },
    ]);
  });

  it("read like a GitHub repository", async () => {
    const data = await getLocalRepositoryData("demo");
    expect(data.fileTree.split("\n")).toEqual([
      "README.md",
      "src",
      "src/blob.bin",
      "src/main.ts",
      "src/util.ts",
    ]);
    expect(data.pathTypes.get("src")).toBe("tree");
    expect(data.pathTypes.get("src/main.ts")).toBe("blob");
    expect(data.sourceBlobs?.get("src/util.ts")?.size).toBe(23);
    expect(data.readme).toBe("# Demo\n");
    expect(data.localRoot).toBe(demo);
    expect(data.isPrivate).toBe(false);
  });

  it("serve text sources from inside the folder only", async () => {
    expect(await readLocalSource(demo, "src/util.ts", 1000)).toBe(
      "export const util = 1;\n",
    );
    expect(await readLocalSource(demo, "src/blob.bin", 1000)).toBeNull();
    expect(await readLocalSource(demo, "src/util.ts", 5)).toBeNull();
    expect(await readLocalSource(demo, "../demo/src/util.ts", 1000)).toBe(
      "export const util = 1;\n",
    );
    expect(
      await readLocalSource(path.join(demo, "src"), "../README.md", 1000),
    ).toBeNull();
  });
});
