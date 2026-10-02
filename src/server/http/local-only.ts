import { isLocalMode } from "~/server/storage/config";

import { isSameOriginRequest } from "./same-origin";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function json(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

/**
 * Local mode's folder browser, folder registration and model settings can read
 * the whole disk and choose where requests go, so they answer only the browser
 * on this machine:
 * - local mode only (GITDIAGRAM_LOCAL=1);
 * - never while the server is shared on the network (GITDIAGRAM_LAN=1, set by
 *   `run.bat --lan`), where a Host header can be forged;
 * - the request must be addressed to localhost, which also defeats DNS
 *   rebinding from a web page;
 * - changes must come from the app's own pages (same origin).
 * Returns the refusal, or null when the request may proceed.
 */
export function localOnlyRejection(
  request: Request,
  options: { mutating: boolean },
): Response | null {
  if (!isLocalMode()) return json(404, "Not available.");
  if (process.env.GITDIAGRAM_LAN?.trim() === "1") {
    return json(
      403,
      "Disabled while the server is shared on the network (--lan). Use it from this machine without --lan.",
    );
  }
  const host = request.headers.get("host") ?? "";
  let hostname = "";
  try {
    hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    hostname = "";
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    return json(403, "Only available from this machine (http://localhost).");
  }
  if (options.mutating && !isSameOriginRequest(request)) {
    return json(403, "Cross-site request refused.");
  }
  return null;
}
