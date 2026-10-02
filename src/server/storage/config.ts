import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * GITDIAGRAM_LOCAL=1 runs without hosted services: objects are stored on disk
 * (local-object-store.ts) instead of R2, and Redis commands run in process
 * (local-redis.ts) instead of on Upstash.
 */
export function isLocalMode(): boolean {
  return readEnv("GITDIAGRAM_LOCAL") === "1";
}

/** Where local mode keeps its objects and secret (LOCAL_DATA_DIR). */
export function getLocalDataDir(): string {
  // a runtime folder, not a project file: keep it out of the build's file trace
  return path.resolve(
    /*turbopackIgnore: true*/ readEnv("LOCAL_DATA_DIR") ?? ".local-data",
  );
}

// Bucket names only become folder names under the local data directory.
const LOCAL_ENV_DEFAULTS: Record<string, string> = {
  R2_PUBLIC_BUCKET: "public",
  R2_PRIVATE_BUCKET: "private",
};

let localSecret: string | undefined;

/** A random secret made once per install and kept with the local data. */
function getLocalSecret(): string {
  if (localSecret) return localSecret;
  const file = path.join(getLocalDataDir(), "cache-key-secret");
  try {
    localSecret = readFileSync(file, "utf8").trim();
  } catch {
    localSecret = "";
  }
  if (localSecret.length < 32) {
    localSecret = randomBytes(32).toString("hex");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, localSecret, { mode: 0o600 });
  }
  return localSecret;
}

export function assertLiveStorageAllowedForTests(service: string): void {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.ALLOW_LIVE_STORAGE_IN_TESTS !== "1"
  ) {
    throw new Error(
      `${service} access is disabled during tests. Mock the storage module or set ALLOW_LIVE_STORAGE_IN_TESTS=1 for an intentional live-storage test.`,
    );
  }
}

export function readRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (value) {
    return value;
  }
  if (isLocalMode()) {
    if (name === "CACHE_KEY_SECRET") {
      return getLocalSecret();
    }
    const fallback = LOCAL_ENV_DEFAULTS[name];
    if (fallback) {
      return fallback;
    }
  }
  throw new Error(`Missing ${name}.`);
}
