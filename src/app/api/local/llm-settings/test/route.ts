import { checkLocalEndpoint } from "~/server/generate/local-llm";
import { localOnlyRejection } from "~/server/http/local-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/local/llm-settings/test — can the endpoint list its models? */
export async function POST(request: Request) {
  const refusal = localOnlyRejection(request, { mutating: true });
  return refusal ?? Response.json(await checkLocalEndpoint());
}
