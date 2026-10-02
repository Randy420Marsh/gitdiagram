// AI_PROVIDER=local: any OpenAI-compatible server with the Responses API — a
// llama.cpp llama-server on this machine, or a remote API such as OpenRouter
// (https://openrouter.ai/api/v1).
//
// Where the settings come from, first match wins:
//   1. the Model dialog in the app, saved in <LOCAL_DATA_DIR>/llm-settings.json
//   2. .env.local: LOCAL_LLM_BASE_URL, LOCAL_LLM_MODEL, LOCAL_LLM_API_KEY,
//      LOCAL_LLM_REASONING_EFFORT
//   3. defaults: http://127.0.0.1:8080/v1, no key
// The key can also name an environment variable instead of holding the key
// (apiKeyEnv, e.g. OPENROUTER_API_KEY); an openrouter.ai URL with no key at
// all uses OPENROUTER_API_KEY.
//
// llama-server reports which reasoning_effort values the loaded model's chat
// template accepts (/props reasoning_efforts, e.g. low / medium / xhigh for
// Qwen3.8); any other value makes the template raise. The app's per-stage
// choice (low / medium / high) is therefore sent as the nearest level the
// model has. The reasoning-effort setting overrides it: a fixed level for
// every request, or "default" to send none and let the server decide.
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { getLocalDataDir } from "~/server/storage/config";

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
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What the Model dialog saves. Empty or missing fields fall back to .env.local. */
export interface LocalLlmSettings {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** read the key from this environment variable instead */
  apiKeyEnv?: string;
  reasoningEffort?: string;
}

const SETTING_KEYS = [
  "baseUrl",
  "model",
  "apiKey",
  "apiKeyEnv",
  "reasoningEffort",
] as const;

function readEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function settingsFile(): string {
  return path.join(
    /*turbopackIgnore: true*/ getLocalDataDir(),
    "llm-settings.json",
  );
}

let settingsCache: { mtimeMs: number; settings: LocalLlmSettings } | null =
  null;

export function readLocalLlmSettings(): LocalLlmSettings {
  const file = settingsFile();
  let mtimeMs: number;
  try {
    mtimeMs = statSync(/*turbopackIgnore: true*/ file).mtimeMs;
  } catch {
    settingsCache = null;
    return {};
  }
  if (settingsCache?.mtimeMs === mtimeMs) return settingsCache.settings;
  let settings: LocalLlmSettings = {};
  try {
    const parsed = JSON.parse(
      readFileSync(/*turbopackIgnore: true*/ file, "utf8"),
    ) as Record<string, unknown>;
    for (const key of SETTING_KEYS) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) {
        settings[key] = value.trim();
      }
    }
  } catch {
    settings = {};
  }
  settingsCache = { mtimeMs, settings };
  return settings;
}

/** Merge into the saved settings; an empty string clears that field. */
export function writeLocalLlmSettings(
  patch: Partial<Record<keyof LocalLlmSettings, string | null>>,
): LocalLlmSettings {
  const next: LocalLlmSettings = { ...readLocalLlmSettings() };
  for (const key of SETTING_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key]?.trim() ?? "";
    if (value) next[key] = value;
    else delete next[key];
  }
  if (next.apiKeyEnv && !ENV_NAME.test(next.apiKeyEnv)) {
    throw new Error("apiKeyEnv must be an environment variable name.");
  }
  if (next.baseUrl) {
    const url = new URL(next.baseUrl); // throws on garbage
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("The endpoint must be an http or https URL.");
    }
  }
  const file = settingsFile();
  mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(/*turbopackIgnore: true*/ temp, JSON.stringify(next, null, 2), {
    mode: 0o600,
  });
  renameSync(/*turbopackIgnore: true*/ temp, file);
  settingsCache = null;
  return next;
}

export function getLocalBaseUrl(): string {
  return (
    readLocalLlmSettings().baseUrl ??
    readEnvValue("LOCAL_LLM_BASE_URL") ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
}

export function getLocalModel(): string {
  return (
    readLocalLlmSettings().model ??
    readEnvValue("LOCAL_LLM_MODEL") ??
    DEFAULT_MODEL
  );
}

function isOpenRouter(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.endsWith("openrouter.ai");
  } catch {
    return false;
  }
}

/** Where the key comes from, for the Model dialog (never the key itself). */
export function describeLocalApiKey(): {
  source: "settings" | "env" | "none";
  name?: string;
} {
  const settings = readLocalLlmSettings();
  if (settings.apiKey) return { source: "settings" };
  if (settings.apiKeyEnv) {
    return readEnvValue(settings.apiKeyEnv)
      ? { source: "env", name: settings.apiKeyEnv }
      : { source: "none", name: settings.apiKeyEnv };
  }
  if (readEnvValue("LOCAL_LLM_API_KEY")) {
    return { source: "env", name: "LOCAL_LLM_API_KEY" };
  }
  if (isOpenRouter(getLocalBaseUrl()) && readEnvValue("OPENROUTER_API_KEY")) {
    return { source: "env", name: "OPENROUTER_API_KEY" };
  }
  return { source: "none" };
}

/** llama-server ignores the key unless it was started with --api-key. */
export function getLocalApiKey(): string {
  const settings = readLocalLlmSettings();
  return (
    settings.apiKey ??
    (settings.apiKeyEnv ? readEnvValue(settings.apiKeyEnv) : undefined) ??
    readEnvValue("LOCAL_LLM_API_KEY") ??
    (isOpenRouter(getLocalBaseUrl())
      ? readEnvValue("OPENROUTER_API_KEY")
      : undefined) ??
    "local"
  );
}

export function getLocalReasoningSetting(): string | undefined {
  return (
    readLocalLlmSettings().reasoningEffort ??
    readEnvValue("LOCAL_LLM_REASONING_EFFORT")
  )?.toLowerCase();
}

/** Only a server on this machine or the LAN can be a llama-server with /props. */
function isPrivateHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
    return (
      host === "localhost" ||
      host === "::1" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

let propsCache: {
  baseUrl: string;
  at: number;
  efforts: string[] | null;
} | null = null;

/** The effort levels the server reports, or null when it does not say. */
async function getReportedEfforts(): Promise<string[] | null> {
  const baseUrl = getLocalBaseUrl();
  if (!isPrivateHost(baseUrl)) return null; // a hosted API: send as asked
  if (
    propsCache?.baseUrl === baseUrl &&
    Date.now() - propsCache.at < PROPS_TTL_MS
  ) {
    return propsCache.efforts;
  }
  let efforts: string[] | null = null;
  try {
    const origin = baseUrl.replace(/\/v1$/, "");
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
  propsCache = { baseUrl, at: Date.now(), efforts };
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
 * The reasoning effort to send for the app's choice, or undefined to send none
 * (the model has no levels, or "default" is set).
 */
export async function resolveLocalReasoningEffort(
  appEffort: string | undefined,
): Promise<string | undefined> {
  const override = getLocalReasoningSetting();
  if (override === "default") return undefined;
  const wanted = override && override !== "app" ? override : appEffort;
  if (!wanted) return undefined;
  const supported = await getReportedEfforts();
  if (!supported) return wanted;
  return nearestEffort(wanted, supported);
}

/** GET {base}/models with the configured key: is the endpoint usable? */
export async function checkLocalEndpoint(): Promise<{
  ok: boolean;
  status?: number;
  models?: string[];
  error?: string;
}> {
  try {
    const response = await fetch(`${getLocalBaseUrl()}/models`, {
      headers: { Authorization: `Bearer ${getLocalApiKey()}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: response.statusText };
    }
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const models = (body.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string");
    return { ok: true, status: response.status, models };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
