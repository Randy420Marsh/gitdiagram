import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MainCard, { looksLikeFolderPath } from "~/components/main-card";
import { recordRecentDiagram } from "~/features/recent/recent-diagrams";

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("~/lib/analytics-client", () => ({ captureAnalyticsEvent: capture }));

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
  }),
  usePathname: () => "/",
}));

describe("MainCard", () => {
  beforeEach(() => {
    push.mockReset();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    capture.mockReset();
  });

  it("accepts owner/repo shorthand input", () => {
    render(<MainCard />);

    const input = screen.getByRole("textbox", {
      name: "GitHub repository",
    });
    fireEvent.change(input, {
      target: { value: "facebook/react" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Diagram" }));

    expect(push).toHaveBeenCalledWith("/facebook/react");
    expect(
      screen.queryByText(
        "Please enter a valid GitHub repository URL or owner/repo",
      ),
    ).not.toBeInTheDocument();
  });

  it("associates invalid input feedback with the repository field", () => {
    render(<MainCard />);

    const input = screen.getByRole("textbox", {
      name: "GitHub repository",
    });
    fireEvent.change(input, { target: { value: "not-a-repository" } });
    fireEvent.click(screen.getByRole("button", { name: "Diagram" }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "Please enter a valid GitHub repository URL or owner/repo",
    );
  });

  it("shows no example repositories and no folder browser outside local mode", () => {
    render(<MainCard />);
    expect(screen.queryByText(/example repositories/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /browse/i }),
    ).not.toBeInTheDocument();
  });

  it("shows no recent row to a first-time visitor", () => {
    render(<MainCard />);
    expect(screen.queryByText("Recent:")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear recent diagrams" }),
    ).not.toBeInTheDocument();
  });

  it("offers recent public diagrams, newest first, and can forget them", () => {
    recordRecentDiagram({ owner: "acme", repo: "older" });
    recordRecentDiagram({ owner: "facebook", repo: "react" });
    render(<MainCard />);

    const chips = screen
      .getAllByRole("button")
      .filter((button) => button.title.includes("/"));
    expect(chips.map((chip) => chip.title)).toEqual([
      "facebook/react",
      "acme/older",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "facebook/react" }));
    expect(push).toHaveBeenCalledWith("/facebook/react");
    expect(capture).toHaveBeenCalledWith("recent_diagram_clicked", {
      repository: "facebook/react",
      position: 0,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Clear recent diagrams" }),
    );
    expect(screen.queryByText("Recent:")).not.toBeInTheDocument();
  });
});

describe("looksLikeFolderPath", () => {
  it.each([
    ["C:\\Projects\\app", true],
    ["c:/projects/app", true],
    ['"D:\\Code\\my app"', true],
    ["\\\\server\\share\\repo", true],
    ["/home/me/project", true],
    ["~/project", true],
    ["owner/repo", false],
    ["https://github.com/owner/repo", false],
    ["repo", false],
  ])("%s -> %s", (input, expected) => {
    expect(looksLikeFolderPath(input)).toBe(expected);
  });
});

describe("MainCard in local mode", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("opens a typed folder path through the server", async () => {
    vi.stubEnv("NEXT_PUBLIC_GITDIAGRAM_LOCAL", "1");
    vi.resetModules();
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, name: "app", url: "/local/app" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { default: LocalMainCard } = await import("~/components/main-card");
    render(<LocalMainCard />);

    expect(screen.getByRole("button", { name: /browse/i })).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Folder or GitHub repository" }),
      { target: { value: "C:\\Projects\\app" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Diagram" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/local/app"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "C:\\Projects\\app" }),
      }),
    );
  });
});
