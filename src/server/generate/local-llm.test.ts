import { afterEach, describe, expect, it, vi } from "vitest";

import {
  nearestEffort,
  resolveLocalReasoningEffort,
} from "~/server/generate/local-llm";
import { getModel, getProvider } from "~/server/generate/model-config";
import { resolvePricingModel } from "~/server/generate/pricing";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("local provider", () => {
  it("is selected by AI_PROVIDER=local and costs nothing", () => {
    vi.stubEnv("AI_PROVIDER", "local");
    vi.stubEnv("LOCAL_LLM_MODEL", "Qwen3.8-27B");
    expect(getProvider()).toBe("local");
    expect(getModel()).toBe("Qwen3.8-27B");
    expect(resolvePricingModel("Qwen3.8-27B")).toBe("local");
  });
});

describe("local reasoning effort", () => {
  it("picks the model's nearest level, ties going up", () => {
    const qwen = ["low", "medium", "xhigh"];
    expect(nearestEffort("medium", qwen)).toBe("medium");
    expect(nearestEffort("high", qwen)).toBe("xhigh");
    expect(nearestEffort("minimal", qwen)).toBe("low");
    expect(nearestEffort("high", ["low", "medium"])).toBe("medium");
    expect(nearestEffort("low", [])).toBeUndefined();
  });

  it("maps the app's choice onto what /props reports", async () => {
    vi.stubEnv("LOCAL_LLM_BASE_URL", "http://127.0.0.1:65001/v1");
    const fetchMock = vi.fn(async () =>
      Response.json({ reasoning_efforts: ["low", "medium", "xhigh"] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveLocalReasoningEffort("high")).toBe("xhigh");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:65001/props",
      expect.anything(),
    );
  });

  it("can be pinned or left to the template", async () => {
    vi.stubEnv("LOCAL_LLM_REASONING_EFFORT", "default");
    expect(await resolveLocalReasoningEffort("medium")).toBeUndefined();
  });
});
