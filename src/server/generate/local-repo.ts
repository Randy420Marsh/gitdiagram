// Local folders as repositories (local mode only): /local/<name> diagrams the
// folder <name> directly inside one of LOCAL_REPO_ROOTS. The result has the
// same shape GitHub ingestion returns, so the rest of the pipeline is shared;
// `localRoot` tells the source reader to read files from disk.
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { isLocalMode } from "~/server/storage/config";

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

/** The folder for /local/<name>, or null if no root holds one by that name. */
export async function resolveLocalRepository(
  name: string,
): Promise<string | null> {
  if (!SAFE_NAME.test(name) || name === "." || name === "..") return null;
  for (const root of getLocalRepoRoots()) {
    const candidate = path.join(root, name);
    // the name must stay one level below the root (no traversal)
    if (path.dirname(candidate) !== root) continue;
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // not in this root
    }
  }
  return null;
}

/** The folders available as /local/<name>, sorted by name. */
export async function listLocalRepositories(): Promise<
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
