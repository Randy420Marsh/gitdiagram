import { browseLocalFolder } from "~/server/generate/local-repo";
import { localOnlyRejection } from "~/server/http/local-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/local/browse?path=... — sub-folders for the folder picker. */
export async function GET(request: Request) {
  const refusal = localOnlyRejection(request, { mutating: false });
  if (refusal) return refusal;
  const folder = new URL(request.url).searchParams.get("path") ?? "";
  try {
    return Response.json({ ok: true, ...(await browseLocalFolder(folder)) });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Cannot read folder.",
      },
      { status: 404 },
    );
  }
}
