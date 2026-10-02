import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { readRequiredEnv } from "~/server/storage/config";
import {
  deleteObject,
  getGzipJsonObject,
  getGzipJsonObjectWithEtag,
  getJsonObject,
  hasObject,
  listObjects,
  putGzipJsonObject,
  putJsonObject,
} from "~/server/storage/r2";
import { upstashCommand, upstashEval } from "~/server/storage/upstash";

const dataDir = mkdtempSync(path.join(tmpdir(), "gitdiagram-local-"));

beforeEach(() => {
  vi.stubEnv("GITDIAGRAM_LOCAL", "1");
  vi.stubEnv("LOCAL_DATA_DIR", dataDir);
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("local mode configuration", () => {
  it("names local buckets and keeps one secret per install", () => {
    expect(readRequiredEnv("R2_PUBLIC_BUCKET")).toBe("public");
    const secret = readRequiredEnv("CACHE_KEY_SECRET");
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(readRequiredEnv("CACHE_KEY_SECRET")).toBe(secret);
  });

  it("still requires what has no local meaning", () => {
    expect(() => readRequiredEnv("STRIPE_SECRET_KEY")).toThrow(
      "Missing STRIPE_SECRET_KEY.",
    );
  });
});

describe("local object store", () => {
  it("round-trips JSON and gzip JSON and lists by prefix", async () => {
    await putJsonObject("public", "a/b/one.json", { n: 1 });
    await putGzipJsonObject("public", "a/two.json.gz", { n: 2 });
    await putJsonObject("public", "other/three.json", { n: 3 });

    expect(await getJsonObject("public", "a/b/one.json")).toEqual({ n: 1 });
    expect(await getGzipJsonObject("public", "a/two.json.gz")).toEqual({
      n: 2,
    });
    expect((await listObjects("public", "a/")).map((o) => o.key)).toEqual([
      "a/b/one.json",
      "a/two.json.gz",
    ]);
    expect(await getJsonObject("public", "missing.json")).toBeNull();
  });

  it("honors conditional writes like R2", async () => {
    await putGzipJsonObject(
      "public",
      "manifest",
      { v: 1 },
      { ifNoneMatch: true },
    );
    await expect(
      putGzipJsonObject("public", "manifest", { v: 2 }, { ifNoneMatch: true }),
    ).rejects.toMatchObject({ name: "PreconditionFailed" });

    const current = await getGzipJsonObjectWithEtag("public", "manifest");
    await putGzipJsonObject(
      "public",
      "manifest",
      { v: 2 },
      { ifMatch: current!.etag },
    );
    await expect(
      putGzipJsonObject(
        "public",
        "manifest",
        { v: 3 },
        { ifMatch: current!.etag },
      ),
    ).rejects.toMatchObject({ name: "PreconditionFailed" });
    expect(await getGzipJsonObject("public", "manifest")).toEqual({ v: 2 });
  });

  it("keeps odd key characters inside the bucket folder", async () => {
    await putJsonObject("private", "owner/repo name*?/x.json", { ok: true });
    expect(await hasObject("private", "owner/repo name*?/x.json")).toBe(true);
    expect((await listObjects("private", "owner/"))[0]?.key).toBe(
      "owner/repo name*?/x.json",
    );
    await deleteObject("private", "owner/repo name*?/x.json");
    expect(await hasObject("private", "owner/repo name*?/x.json")).toBe(false);
    await expect(putJsonObject("private", "../escape", {})).rejects.toThrow(
      "Invalid object key segment",
    );
  });
});

describe("local Redis", () => {
  it("answers commands in Upstash's shapes", async () => {
    expect(await upstashCommand(["SET", "lock", "1", "NX", "PX", 5000])).toBe(
      "OK",
    );
    expect(
      await upstashCommand(["SET", "lock", "2", "NX", "PX", 5000]),
    ).toBeNull();
    await upstashCommand(["HSET", "h", "a", "1", "b", "2"]);
    expect(await upstashCommand(["HGETALL", "h"])).toEqual([
      "a",
      "1",
      "b",
      "2",
    ]);
  });

  it("runs the app's Lua scripts, nil replies included", async () => {
    const script =
      "local n = redis.call('INCRBY', KEYS[1], ARGV[1]) return {n, redis.call('GET', KEYS[2])}";
    expect(
      await upstashEval({ script, keys: ["count", "absent"], args: [3] }),
    ).toEqual([3, null]);
  });
});
