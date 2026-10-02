// Local mode's stand-in for Upstash (see isLocalMode): an in-process Redis
// (ioredis-mock, Lua through fengari), so the app's real commands and Lua
// scripts run unchanged. State lives for the server's lifetime only: what is
// kept in Redis here is rate limits, locks, cancellation flags and caches.
// Replies are reshaped to what Upstash's REST API returns.
import type IORedisMock from "ioredis-mock";

type MockClient = InstanceType<typeof IORedisMock>;

const globalForRedis = globalThis as typeof globalThis & {
  __gitdiagramLocalRedis?: Promise<MockClient>;
};

// One instance per process, kept across Next.js dev reloads.
function getClient(): Promise<MockClient> {
  globalForRedis.__gitdiagramLocalRedis ??= import("ioredis-mock").then(
    ({ default: RedisMock }) => new RedisMock(),
  );
  return globalForRedis.__gitdiagramLocalRedis;
}

/** Real Redis turns Lua false into a nil reply and true into 1. */
function normalizeReply(value: unknown): unknown {
  if (value === false) return null;
  if (value === true) return 1;
  if (Array.isArray(value)) return value.map(normalizeReply);
  return value;
}

export async function localRedisCommand<T>(command: unknown[]): Promise<T> {
  const [name, ...args] = command;
  const client = await getClient();
  const method = String(name).toLowerCase();
  const fn = (client as unknown as Record<string, unknown>)[method];
  if (typeof fn !== "function") {
    throw new Error(
      `Redis command not available in local mode: ${String(name)}`,
    );
  }
  const reply = await (fn as (...a: unknown[]) => Promise<unknown>).apply(
    client,
    args,
  );
  // ioredis returns HGETALL as an object; Upstash returns the flat field/value list.
  if (method === "hgetall" && reply && !Array.isArray(reply)) {
    return Object.entries(reply as Record<string, unknown>).flat() as T;
  }
  return normalizeReply(reply) as T;
}

export async function localRedisEval<T>(params: {
  script: string;
  keys?: string[];
  args?: Array<string | number>;
}): Promise<T> {
  const keys = params.keys ?? [];
  const client = await getClient();
  const reply = await client.eval(
    params.script,
    keys.length,
    ...keys,
    ...(params.args ?? []),
  );
  return normalizeReply(reply) as T;
}

export async function localRedisPipeline(
  commands: unknown[][],
): Promise<Array<{ result?: unknown; error?: string }>> {
  const results: Array<{ result?: unknown; error?: string }> = [];
  for (const command of commands) {
    try {
      results.push({ result: await localRedisCommand(command) });
    } catch (error) {
      results.push({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
