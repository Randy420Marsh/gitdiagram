import { registerLocalPath } from "~/server/generate/local-repo";
import { localOnlyRejection } from "~/server/http/local-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/local/register {path} — the /local/<name> for a folder path. */
export async function POST(request: Request) {
  const refusal = localOnlyRejection(request, { mutating: true });
  if (refusal) return refusal;
  let folder = "";
  try {
    const body = (await request.json()) as { path?: unknown };
    folder = typeof body.path === "string" ? body.path : "";
  } catch {
    folder = "";
  }
  try {
    const { name, path } = await registerLocalPath(folder);
    return Response.json({
      ok: true,
      name,
      path,
      url: `/local/${encodeURIComponent(name)}`,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid folder.",
      },
      { status: 400 },
    );
  }
}
