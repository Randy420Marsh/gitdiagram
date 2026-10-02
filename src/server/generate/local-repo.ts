// Local folders as repositories (local mode only): /local/<name> diagrams a
// folder on this machine — one picked or typed in the app (kept in
// <LOCAL_DATA_DIR>/local-repos.json), or the folder <name> directly inside one
// of LOCAL_REPO_ROOTS. The result has the same shape GitHub ingestion returns,
// so the rest of the pipeline is shared; `localRoot` tells the source reader to
// read files from disk.
import { execFile } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { getLocalDataDir, isLocalMode } from "~/server/storage/config";

import {
  EMPTY_REPOSITORY_ERROR,
  getGithubData,
  MAX_README_BYTES,
  REPOSITORY_NOT_FOUND_ERROR,
  shouldIncludeFile,
  type GithubData,
  type RepositoryPathType,
  type SourceBlob,
} from "./github";

const execFileAsync = promisify(execFile);

/** The owner segment of a local folder's URL: /local/<name>. */
const LOCAL_OWNER = "local";
// GitHub stops listing a tree at 100,000 entries; the same bound here.
const MAX_LOCAL_ENTRIES = 100_000;
const GIT_TIMEOUT_MS = 20_000;
// Without git there is no .gitignore to honor: skip what is never source.
const WALK_SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".venv",
  "build",
  "dist",
  "out",
  "target",
]);
const README_NAMES = ["readme.md", "readme.rst", "readme.txt", "readme"];
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function isLocalRepository(username: string): boolean {
  return isLocalMode() && username.toLowerCase() === LOCAL_OWNER;
}

/** LOCAL_REPO_ROOTS: folders whose direct sub-folders can be diagrammed. */
function getLocalRepoRoots(): string[] {
  return (process.env.LOCAL_REPO_ROOTS ?? "")
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => path.resolve(root));
}

function registryFile(): string {
  return path.join(
    /*turbopackIgnore: true*/ getLocalDataDir(),
    "local-repos.json",
  );
}

/** Folders picked in the app: name -> absolute path. */
async function readRegistry(): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(
      await readFile(/*turbopackIgnore: true*/ registryFile(), "utf8"),
    ) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          SAFE_NAME.test(entry[0]) && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

async function writeRegistry(registry: Record<string, string>): Promise<void> {
  const file = registryFile();
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), {
    recursive: true,
  });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(
    /*turbopackIgnore: true*/ temp,
    JSON.stringify(registry, null, 2),
  );
  await rename(/*turbopackIgnore: true*/ temp, file);
}

async function isDirectory(folder: string): Promise<boolean> {
  try {
    return (await stat(/*turbopackIgnore: true*/ folder)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A typed path as an absolute folder path: surrounding quotes dropped, `~`
 * expanded, Windows or POSIX form as the server's OS uses. Null when the
 * input is not an absolute path.
 */
export function normalizeLocalPath(input: string): string | null {
  let value = input.trim().replace(/^["']|["']$/g, "");
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    value = path.join(os.homedir(), value.slice(1));
  }
  if (!path.isAbsolute(value)) return null;
  // C: alone means "the current folder on C:" to Windows; a drive is meant
  if (/^[A-Za-z]:$/.test(value)) value += path.sep;
  return path.resolve(value);
}

function sameFolder(a: string, b: string): boolean {
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

/**
 * A URL-safe name for a folder: its own name, made safe and unique, and lower
 * case like every repository address in the app (the proxy redirects /x/Y to
 * /x/y).
 */
function folderName(folder: string, taken: Set<string>): string {
  const base =
    path
      .basename(folder)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 80) || "folder";
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}-${n}`;
  return name;
}

/**
 * Make a folder on this machine diagrammable and return its /local/<name>.
 * A folder directly inside a LOCAL_REPO_ROOTS root keeps its own name; any
 * other is remembered in the registry (the same path always gets the same
 * name).
 */
export async function registerLocalPath(
  input: string,
): Promise<{ name: string; path: string }> {
  const folder = normalizeLocalPath(input);
  if (!folder) {
    throw new Error(
      "Enter a full folder path, such as C:\\Projects\\app or /home/me/app.",
    );
  }
  if (!(await isDirectory(folder))) {
    throw new Error(`Folder not found: ${folder}`);
  }
  const name = path.basename(folder);
  if (
    SAFE_NAME.test(name) &&
    getLocalRepoRoots().some((root) => sameFolder(path.dirname(folder), root))
  ) {
    return { name: name.toLowerCase(), path: folder };
  }
  const registry = await readRegistry();
  const existing = Object.entries(registry).find(([, saved]) =>
    sameFolder(saved, folder),
  );
  if (existing) return { name: existing[0], path: folder };
  const taken = new Set(
    [
      ...Object.keys(registry),
      ...(await listRootFolders()).map((entry) => entry.name),
    ].map((value) => value.toLowerCase()),
  );
  const assigned = folderName(folder, taken);
  await writeRegistry({ ...registry, [assigned]: folder });
  return { name: assigned, path: folder };
}

interface LocalFolderEntry {
  name: string;
  path: string;
  /** holds a .git folder or file */
  git?: boolean;
}

export interface LocalFolderListing {
  /** null: the starting points (drives, home, roots) are listed */
  path: string | null;
  parent: string | null;
  entries: LocalFolderEntry[];
  git: boolean;
}

const MAX_BROWSE_ENTRIES = 1_000;
const HIDDEN_WINDOWS_FOLDERS = new Set([
  "system volume information",
  "recovery",
  "config.msi",
]);

/** Where browsing starts: drives (Windows) or /, home, and the roots. */
async function localPlaces(): Promise<LocalFolderEntry[]> {
  const places: LocalFolderEntry[] = [];
  if (process.platform === "win32") {
    for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
      const drive = `${letter}:\\`;
      if (await isDirectory(drive)) places.push({ name: drive, path: drive });
    }
  } else {
    places.push({ name: "/", path: "/" });
  }
  places.push({ name: `Home (${os.homedir()})`, path: os.homedir() });
  for (const root of getLocalRepoRoots()) {
    if (await isDirectory(root)) places.push({ name: root, path: root });
  }
  return places;
}

async function hasGit(folder: string): Promise<boolean> {
  try {
    await stat(
      /*turbopackIgnore: true*/ path.join(
        /*turbopackIgnore: true*/ folder,
        ".git",
      ),
    );
    return true;
  } catch {
    return false;
  }
}

/** The sub-folders of a folder, for the app's folder picker. */
export async function browseLocalFolder(
  input?: string,
): Promise<LocalFolderListing> {
  if (!input?.trim()) {
    return {
      path: null,
      parent: null,
      entries: await localPlaces(),
      git: false,
    };
  }
  const folder = normalizeLocalPath(input);
  if (!folder || !(await isDirectory(folder))) {
    throw new Error(`Folder not found: ${input.trim()}`);
  }
  let dirents: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    dirents = await readdir(/*turbopackIgnore: true*/ folder, {
      withFileTypes: true,
    });
  } catch {
    dirents = []; // no permission: show it empty rather than fail
  }
  const children = dirents
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !entry.name.startsWith("$") &&
        !HIDDEN_WINDOWS_FOLDERS.has(entry.name.toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .slice(0, MAX_BROWSE_ENTRIES);
  const entries = await Promise.all(
    children.map(async (name) => {
      const child = path.join(/*turbopackIgnore: true*/ folder, name);
      return { name, path: child, git: await hasGit(child) };
    }),
  );
  const parent = path.dirname(folder);
  return {
    path: folder,
    parent: parent === folder ? null : parent,
    entries,
    git: await hasGit(folder),
  };
}

/** The folder for /local/<name>, or null if no root holds one by that name. */
export async function resolveLocalRepository(
  name: string,
): Promise<string | null> {
  if (!SAFE_NAME.test(name) || name === "." || name === "..") return null;
  // addresses are lower case (the proxy redirects /local/Name to /local/name),
  // folder names need not be: match either way
  const wanted = name.toLowerCase();
  const registry = await readRegistry();
  const key = Object.keys(registry).find(
    (entry) => entry.toLowerCase() === wanted,
  );
  if (key && (await isDirectory(registry[key]!))) return registry[key]!;
  for (const root of getLocalRepoRoots()) {
    // the name must stay one level below the root (no traversal)
    if (path.dirname(path.join(root, name)) !== root) continue;
    let entries: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      entries = await readdir(/*turbopackIgnore: true*/ root, {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    // the folder's own spelling: exact first, then any case
    const match =
      entries.find((entry) => entry.isDirectory() && entry.name === name) ??
      entries.find(
        (entry) => entry.isDirectory() && entry.name.toLowerCase() === wanted,
      );
    if (match) return path.join(/*turbopackIgnore: true*/ root, match.name);
  }
  return null;
}

/** The folders available as /local/<name>, sorted by name. */
export async function listLocalRepositories(): Promise<
  Array<{ name: string; path: string }>
> {
  const seen = new Map<string, string>();
  for (const entry of await listRootFolders()) seen.set(entry.name, entry.path);
  for (const [name, folder] of Object.entries(await readRegistry())) {
    if (!seen.has(name) && (await isDirectory(folder))) seen.set(name, folder);
  }
  return [...seen]
    .map(([name, folder]) => ({ name, path: folder }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The direct sub-folders of the LOCAL_REPO_ROOTS roots. */
async function listRootFolders(): Promise<
  Array<{ name: string; path: string }>
> {
  const seen = new Map<string, string>();
  for (const root of getLocalRepoRoots()) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        SAFE_NAME.test(entry.name) &&
        !entry.name.startsWith(".") &&
        !seen.has(entry.name)
      ) {
        seen.set(entry.name, path.join(root, entry.name));
      }
    }
  }
  return [...seen]
    .map(([name, folder]) => ({ name, path: folder }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function git(folder: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", folder, ...args], {
    maxBuffer: 256 * 1024 * 1024,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });
  return stdout;
}

/** Files git would show (tracked + untracked, .gitignore honored), or null. */
async function listGitFiles(folder: string): Promise<string[] | null> {
  try {
    const out = await git(folder, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ]);
    return [...new Set(out.split("\0").filter(Boolean))];
  } catch {
    return null; // not a git work tree, or git is not installed
  }
}

async function walkFiles(
  folder: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const files: string[] = [];
  const queue = [""];
  while (queue.length && files.length < MAX_LOCAL_ENTRIES) {
    signal?.throwIfAborted();
    const relative = queue.shift()!;
    let entries;
    try {
      entries = await readdir(path.join(folder, relative), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // never descend into what the tree filter would drop anyway (venv, node_modules)
        if (
          !WALK_SKIPPED_DIRECTORIES.has(entry.name.toLowerCase()) &&
          shouldIncludeFile(child)
        )
          queue.push(child);
      } else if (entry.isFile()) {
        files.push(child);
      }
    }
  }
  return files;
}

async function currentBranch(folder: string): Promise<string> {
  try {
    const branch = (
      await git(folder, ["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
    return branch && branch !== "HEAD" ? branch : "local";
  } catch {
    return "local";
  }
}

async function readReadme(folder: string): Promise<string> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return "";
  }
  for (const wanted of README_NAMES) {
    const name = names.find((candidate) => candidate.toLowerCase() === wanted);
    if (!name) continue;
    const bytes = await readFile(path.join(folder, name));
    return bytes.subarray(0, MAX_README_BYTES).toString("utf8");
  }
  return "";
}

export async function getLocalRepositoryData(
  name: string,
  signal?: AbortSignal,
): Promise<GithubData> {
  const folder = await resolveLocalRepository(name);
  if (!folder) throw new Error(REPOSITORY_NOT_FOUND_ERROR);

  const listed =
    (await listGitFiles(folder)) ?? (await walkFiles(folder, signal));
  signal?.throwIfAborted();

  const files = listed
    .map((file) => file.replaceAll("\\", "/"))
    .filter(shouldIncludeFile)
    .sort();
  const treeTruncated = files.length > MAX_LOCAL_ENTRIES;
  const kept = files.slice(0, MAX_LOCAL_ENTRIES);

  const pathTypes = new Map<string, RepositoryPathType>();
  const sourceBlobs = new Map<string, SourceBlob>();
  for (const file of kept) {
    // every parent folder is a "tree" entry, as in GitHub's recursive listing
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (shouldIncludeFile(dir)) pathTypes.set(dir, "tree");
    }
    pathTypes.set(file, "blob");
  }
  // sizes for ranking and the source index; deleted-but-tracked files drop out
  await Promise.all(
    kept.map(async (file) => {
      try {
        // user folders, not project files: keep them out of the build's file trace
        const info = await stat(
          /*turbopackIgnore: true*/ path.join(
            /*turbopackIgnore: true*/ folder,
            file,
          ),
        );
        if (info.isFile()) sourceBlobs.set(file, { sha: "", size: info.size });
        else pathTypes.delete(file);
      } catch {
        pathTypes.delete(file);
      }
    }),
  );
  signal?.throwIfAborted();

  const paths = [...pathTypes.keys()].sort();
  if (!paths.length) throw new Error(EMPTY_REPOSITORY_ERROR);

  return {
    defaultBranch: await currentBranch(folder),
    fileTree: paths.join("\n"),
    readme: await readReadme(folder),
    isPrivate: false,
    stargazerCount: null,
    description: `Local folder ${folder}`,
    pathTypes,
    sourceBlobs,
    treeTruncated,
    localRoot: folder,
  };
}

/** A repository's data: a local folder for /local/<name>, else from GitHub. */
export function getRepositoryData(
  username: string,
  repo: string,
  githubPat?: string,
  signal?: AbortSignal,
): Promise<GithubData> {
  return isLocalRepository(username)
    ? getLocalRepositoryData(repo, signal)
    : getGithubData(username, repo, githubPat, signal);
}

/** A source file's text from disk, or null if missing, too big or binary. */
export async function readLocalSource(
  root: string,
  file: string,
  maxBytes: number,
): Promise<string | null> {
  const full = path.resolve(root, file);
  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
  try {
    const info = await stat(full);
    if (!info.isFile() || info.size > maxBytes) return null;
    const bytes = await readFile(full);
    if (bytes.includes(0)) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
