import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/components/main-card", () => ({ default: () => null }));
vi.mock("~/components/hero", () => ({ default: () => null }));
vi.mock("~/components/local-folders", () => ({ LocalFolders: () => null }));

import { LocalFolders } from "~/components/local-folders";
import HomePage, { metadata } from "./page";

describe("home page", () => {
  it("is the local app: folders and repositories, no search-engine markup", () => {
    expect(String(metadata.description)).toContain("folder");
    const children = (
      HomePage().props as { children: ReactNode[] }
    ).children.filter(isValidElement);
    // the list of local folders is part of the page; nothing else is injected
    expect(children.some((child) => child.type === LocalFolders)).toBe(true);
    expect(
      children.some(
        (child) =>
          (child.props as { type?: string }).type === "application/ld+json",
      ),
    ).toBe(false);
  });
});
