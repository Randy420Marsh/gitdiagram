// Local mode's stand-in for R2 (see isLocalMode): one file per object under
// <LOCAL_DATA_DIR>/objects/<bucket>/<key>. Same semantics the callers rely on:
// gzip objects are stored compressed, ETags change with the content, and
// conditional writes fail with a 412-style error. One server process owns the
// directory, so an in-process lock per key makes check-and-write atomic.
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { getLocalDataDir } from "./config";

export type LocalWriteCondition = { ifMatch: string } | { ifNoneMatch: true };

// Windows-safe file names: percent-encoding leaves letters, digits and -_.!~'()
// alone; `*` is the one of those Windows refuses, so it is escaped too.
function encodeSegment(segment: string): string {
  if (!segment || segment === "." || segment === "..") {
    throw new Error(`Invalid object key segment: ${JSON.stringify(segment)}`);
  }
  return encodeURIComponent(segment).replace(/\*/g, "%2A");
}

function decodeSegment(segment: string): string {
  return decodeURIComponent(segment);
}

function bucketDir(bucket: string): string {
  return path.join(getLocalDataDir(), "objects", encodeSegment(bucket));
}

function objectPath(bucket: string, key: string): string {
  return path.join(bucketDir(bucket), ...key.split("/").map(encodeSegment));
}

function etagOf(bytes: Buffer): string {
  return `"${createHash("sha1").update(bytes).digest("hex")}"`;
}

const keyLocks = new Map<string, Promise<unknown>>();

async function withKeyLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const previous = keyLocks.get(file) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const settled = run.catch(() => undefined);
  keyLocks.set(file, settled);
  try {
    return await run;
  } finally {
    if (keyLocks.get(file) === settled) keyLocks.delete(file);
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export async function readObject(
  bucket: string,
  key: string,
): Promise<{ bytes: Buffer; etag: string; lastModified: Date } | null> {
  const file = objectPath(bucket, key);
  try {
    const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
    return { bytes, etag: etagOf(bytes), lastModified: info.mtime };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function preconditionFailed(key: string): Error {
  const error = new Error(`At least one of the preconditions failed: ${key}`);
  error.name = "PreconditionFailed";
  Object.assign(error, { $metadata: { httpStatusCode: 412 } });
  return error;
}

export async function writeObject(
  bucket: string,
  key: string,
  bytes: Buffer,
  condition?: LocalWriteCondition,
): Promise<void> {
  const file = objectPath(bucket, key);
  await withKeyLock(file, async () => {
    if (condition) {
      const current = await readObject(bucket, key);
      if ("ifNoneMatch" in condition && current) throw preconditionFailed(key);
      if ("ifMatch" in condition && current?.etag !== condition.ifMatch)
        throw preconditionFailed(key);
    }
    await mkdir(path.dirname(file), { recursive: true });
    // write-then-rename: a reader never sees half an object
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, file);
  });
}

export async function deleteLocalObject(
  bucket: string,
  key: string,
): Promise<void> {
  await rm(objectPath(bucket, key), { force: true });
}

export async function getLocalObjectInfo(
  bucket: string,
  key: string,
): Promise<{ lastModified: Date | null } | null> {
  try {
    const info = await stat(objectPath(bucket, key));
    return info.isFile() ? { lastModified: info.mtime } : null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Every key under a prefix, with its last-modified time. */
export async function listLocalObjects(
  bucket: string,
  prefix: string,
): Promise<Array<{ key: string; lastModified: Date | null }>> {
  const root = bucketDir(bucket);
  const objects: Array<{ key: string; lastModified: Date | null }> = [];
  async function walk(dir: string, keyPrefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.endsWith(".tmp")) continue;
      const key = keyPrefix + decodeSegment(entry.name);
      // prune folders that cannot hold a matching key
      if (!key.startsWith(prefix) && !prefix.startsWith(key)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, `${key}/`);
      } else if (key.startsWith(prefix)) {
        objects.push({ key, lastModified: (await stat(full)).mtime });
      }
    }
  }
  await walk(root, "");
  return objects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export async function ensureLocalBucket(bucket: string): Promise<void> {
  await mkdir(bucketDir(bucket), { recursive: true });
}
