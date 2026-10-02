import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  browseLocalFolder,
  getLocalRepositoryData,
  isLocalRepository,
  listLocalRepositories,
  normalizeLocalPath,
  readLocalSource,
  registerLocalPath,
  resolveLocalRepository,
} from "~/server/generate/local-repo";

// <root>/demo is a plain folder (no git), so the directory walk is used.
const root = mkdtempSync(path.join(tmpdir(), "gitdiagram-repos-"));
const demo = path.join(root, "demo");
const camel = path.join(root, "CamelRepo");
mkdirSync(camel, { recursive: true });
// a folder outside the roots, picked in the app; another with a clashing name
const outside = mkdtempSync(path.join(tmpdir(), "gitdiagram-elsewhere-"));
const picked = path.join(outside, "My App!");
const clash = path.join(outside, "nested", "demo");
const dataDir = mkdtempSync(path.join(tmpdir(), "gitdiagram-data-"));
mkdirSync(path.join(picked, ".git"), { recursive: true });
mkdirSync(path.join(picked, "src"), { recursive: true });
mkdirSync(clash, { recursive: true });
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
  vi.stubEnv("LOCAL_DATA_DIR", dataDir);
});

afterAll(() => {
  vi.unstubAllEnvs();
  for (const folder of [root, outside, dataDir]) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe("folders picked in the app", () => {
  it("keep a root's sub-folder under its own name", async () => {
    expect(await registerLocalPath(demo)).toEqual({ name: "demo", path: demo });
  });

  it("give any other folder a safe, stable, unique name", async () => {
    const first = await registerLocalPath(`"${picked}"`);
    expect(first).toEqual({ name: "my-app", path: picked });
    expect(await registerLocalPath(picked)).toEqual(first);
    expect(await resolveLocalRepository("my-app")).toBe(picked);
    expect(await resolveLocalRepository("My-App")).toBe(picked);
    // "demo" is taken by the root's folder
    expect((await registerLocalPath(clash)).name).toBe("demo-2");
    expect((await listLocalRepositories()).map((entry) => entry.name)).toEqual([
      "CamelRepo",
      "demo",
      "demo-2",
      "my-app",
    ]);
  });

  it("find a root's folder from its lower-case address", async () => {
    expect(await registerLocalPath(camel)).toEqual({
      name: "camelrepo",
      path: camel,
    });
    // the proxy lower-cases every repository address
    expect(await resolveLocalRepository("camelrepo")).toBe(camel);
  });

  it("refuse what is not a folder", async () => {
    await expect(registerLocalPath("relative/path")).rejects.toThrow(
      "full folder path",
    );
    await expect(
      registerLocalPath(path.join(outside, "missing")),
    ).rejects.toThrow("Folder not found");
  });

  it("are browsed folder by folder, repositories marked", async () => {
    const top = await browseLocalFolder(outside);
    expect(top.entries.map((entry) => [entry.name, entry.git])).toEqual([
      ["My App!", true],
      ["nested", false],
    ]);
    const inside = await browseLocalFolder(picked);
    expect(inside.git).toBe(true);
    expect(inside.parent).toBe(outside);
    // .git is hidden; src is listed
    expect(inside.entries.map((entry) => entry.name)).toEqual(["src"]);
    const places = await browseLocalFolder("");
    expect(places.path).toBeNull();
    expect(places.entries.some((entry) => entry.path === root)).toBe(true);
  });

  it("normalize typed paths", () => {
    expect(normalizeLocalPath("relative")).toBeNull();
    expect(normalizeLocalPath(`  '${picked}'  `)).toBe(picked);
    expect(normalizeLocalPath("~")).toBe(path.resolve(homedir()));
  });
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
    expect(await listLocalRepositories()).toContainEqual({
      name: "demo",
      path: demo,
    });
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
