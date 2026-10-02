// AI_PROVIDER=local: a llama.cpp llama-server (or any OpenAI-compatible server
// with the Responses API) on this machine.
//
// llama-server reports which reasoning_effort values the loaded model's chat
// template accepts (/props reasoning_efforts, e.g. low / medium / xhigh for
// Qwen3.8); any other value makes the template raise. The app's per-stage
// choice (low / medium / high) is therefore sent as the nearest level the
// model has. LOCAL_LLM_REASONING_EFFORT overrides it: a fixed level for every
// request, or "default" to send none and let the template decide.

const DEFAULT_BASE_URL = "http://127.0.0.1:8080/v1";
const DEFAULT_MODEL = "local";
// llama-server's probe order, lowest first.
const EFFORT_LADDER = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const PROPS_TTL_MS = 60_000;
const PROPS_TIMEOUT_MS = 3_000;

function readEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getLocalBaseUrl(): string {
  return (readEnvValue("LOCAL_LLM_BASE_URL") ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

export function getLocalModel(): string {
  return readEnvValue("LOCAL_LLM_MODEL") ?? DEFAULT_MODEL;
}

/** llama-server ignores the key unless it was started with --api-key. */
export function getLocalApiKey(): string {
  return readEnvValue("LOCAL_LLM_API_KEY") ?? "local";
}

let propsCache: { at: number; efforts: string[] | null } | null = null;

/** The effort levels the server reports, or null when it does not say. */
async function getReportedEfforts(): Promise<string[] | null> {
  if (propsCache && Date.now() - propsCache.at < PROPS_TTL_MS) {
    return propsCache.efforts;
  }
  let efforts: string[] | null = null;
  try {
    const origin = getLocalBaseUrl().replace(/\/v1$/, "");
    const response = await fetch(`${origin}/props`, {
      signal: AbortSignal.timeout(PROPS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.ok) {
      const props = (await response.json()) as { reasoning_efforts?: unknown };
      if (Array.isArray(props.reasoning_efforts)) {
        efforts = props.reasoning_efforts.filter(
          (level): level is string => typeof level === "string",
        );
      }
    }
  } catch {
    efforts = null; // not llama-server, or not up yet: send the level as asked
  }
  propsCache = { at: Date.now(), efforts };
  return efforts;
}

function rank(level: string): number {
  const index = EFFORT_LADDER.indexOf(level);
  return index < 0 ? EFFORT_LADDER.length : index;
}

/** The level in `supported` closest to `wanted` (ties go to the higher one). */
export function nearestEffort(
  wanted: string,
  supported: readonly string[],
): string | undefined {
  const levels = supported.filter((level) => level !== "none");
  if (!levels.length) return undefined;
  if (levels.includes(wanted)) return wanted;
  return levels.reduce((best, level) => {
    const distance = Math.abs(rank(level) - rank(wanted));
    const bestDistance = Math.abs(rank(best) - rank(wanted));
    return distance < bestDistance ||
      (distance === bestDistance && rank(level) > rank(best))
      ? level
      : best;
  });
}

/**
 * The reasoning effort to send to the local server for the app's choice, or
 * undefined to send none (the model has no levels, or "default" is set).
 */
export async function resolveLocalReasoningEffort(
  appEffort: string | undefined,
): Promise<string | undefined> {
  const override = readEnvValue("LOCAL_LLM_REASONING_EFFORT")?.toLowerCase();
  if (override === "default") return undefined;
  const wanted = override && override !== "app" ? override : appEffort;
  if (!wanted) return undefined;
  const supported = await getReportedEfforts();
  if (!supported) return wanted;
  return nearestEffort(wanted, supported);
}
