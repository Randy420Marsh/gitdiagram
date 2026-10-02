import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BrowsePageResult } from "~/features/browse/catalog";

import { BrowseCatalogResults } from "./browse-catalog-results";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function page(items: Array<[string, string]>): BrowsePageResult {
  return {
    items: items.map(([username, repo]) => ({
      username,
      repo,
      lastSuccessfulAt: "2026-09-20T12:00:00.000Z",
      stargazerCount: 10,
    })),
    total: items.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    sort: "stars_desc",
    q: "",
    minStars: 0,
  };
}

function results(result: BrowsePageResult) {
  return (
    <BrowseCatalogResults
      closeHoverPreview={() => {}}
      desktopHoverEnabled={false}
      handlePageChange={() => {}}
      handleRepoHoverMove={() => {}}
      handleRepoHoverStart={() => {}}
      hoverPreview={null}
      hoverPreviewDiagram={null}
      hoverPreviewElementRef={{ current: null }}
      hoverPreviewStatus="idle"
      result={result}
    />
  );
}

it("lists only diagrams, and links GitHub only for GitHub repositories", () => {
  vi.stubEnv("NEXT_PUBLIC_GITDIAGRAM_LOCAL", "1");
  render(
    results(
      page([
        ["owner", "a"],
        ["local", "my-folder"],
      ]),
    ),
  );
  const [github, local] = screen.getAllByRole("row").slice(1);
  expect(within(github!).getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/owner/a",
  );
  expect(within(local!).queryByRole("link", { name: "GitHub" })).toBeNull();
  expect(screen.getAllByRole("row")).toHaveLength(3);
});
