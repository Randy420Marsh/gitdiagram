import {
  describeLocalApiKey,
  getLocalBaseUrl,
  getLocalModel,
  getLocalReasoningSetting,
  readLocalLlmSettings,
  writeLocalLlmSettings,
  type LocalLlmSettings,
} from "~/server/generate/local-llm";
import { getProvider } from "~/server/generate/model-config";
import { localOnlyRejection } from "~/server/http/local-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function snapshot() {
  const saved = readLocalLlmSettings();
  return {
    ok: true,
    provider: getProvider(),
    // what requests use now (saved settings over .env.local over defaults)
    effective: {
      baseUrl: getLocalBaseUrl(),
      model: getLocalModel(),
      reasoningEffort: getLocalReasoningSetting() ?? "app",
      apiKey: describeLocalApiKey(),
    },
    // what the dialog saved; the key itself never leaves the server
    saved: {
      baseUrl: saved.baseUrl ?? "",
      model: saved.model ?? "",
      apiKeyEnv: saved.apiKeyEnv ?? "",
      reasoningEffort: saved.reasoningEffort ?? "",
      hasApiKey: Boolean(saved.apiKey),
    },
  };
}

/** GET /api/local/llm-settings — the model endpoint in use. */
export function GET(request: Request) {
  const refusal = localOnlyRejection(request, { mutating: false });
  return refusal ?? Response.json(snapshot());
}

/**
 * PUT /api/local/llm-settings {baseUrl?, model?, apiKey?, apiKeyEnv?,
 * reasoningEffort?} — save; an empty string clears a field (back to
 * .env.local), a missing field is left as it is.
 */
export async function PUT(request: Request) {
  const refusal = localOnlyRejection(request, { mutating: true });
  if (refusal) return refusal;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: Partial<Record<keyof LocalLlmSettings, string>> = {};
    for (const key of [
      "baseUrl",
      "model",
      "apiKey",
      "apiKeyEnv",
      "reasoningEffort",
    ] as const) {
      if (typeof body[key] === "string") patch[key] = body[key];
    }
    writeLocalLlmSettings(patch);
    return Response.json(snapshot());
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid settings.",
      },
      { status: 400 },
    );
  }
}
