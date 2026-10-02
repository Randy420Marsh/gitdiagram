import { afterEach, describe, expect, it, vi } from "vitest";

import { localOnlyRejection } from "./local-only";

function request(host: string, init: RequestInit & { origin?: string } = {}) {
  const headers = new Headers({ host });
  if (init.origin) headers.set("origin", init.origin);
  return new Request(`http://${host}/api/local/browse`, { ...init, headers });
}

afterEach(() => vi.unstubAllEnvs());

describe("localOnlyRejection", () => {
  it("does not exist outside local mode", () => {
    expect(
      localOnlyRejection(request("localhost:3000"), { mutating: false })
        ?.status,
    ).toBe(404);
  });

  it("answers only requests addressed to this machine", () => {
    vi.stubEnv("GITDIAGRAM_LOCAL", "1");
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      expect(localOnlyRejection(request(host), { mutating: false })).toBeNull();
    }
    // a LAN address, or a rebinding domain pointing at 127.0.0.1
    for (const host of ["192.168.1.20:3000", "evil.example:3000"]) {
      expect(
        localOnlyRejection(request(host), { mutating: false })?.status,
      ).toBe(403);
    }
  });

  it("takes changes only from the app's own pages", () => {
    vi.stubEnv("GITDIAGRAM_LOCAL", "1");
    const post = (origin?: string) =>
      localOnlyRejection(
        request("localhost:3000", { method: "POST", origin }),
        { mutating: true },
      );
    expect(post("http://localhost:3000")).toBeNull();
    expect(post("https://evil.example")?.status).toBe(403);
    expect(post()?.status).toBe(403);
  });

  it("is off while the server is shared on the network", () => {
    vi.stubEnv("GITDIAGRAM_LOCAL", "1");
    vi.stubEnv("GITDIAGRAM_LAN", "1");
    expect(
      localOnlyRejection(request("localhost:3000"), { mutating: false })
        ?.status,
    ).toBe(403);
  });
});
