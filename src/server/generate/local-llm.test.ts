import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  describeLocalApiKey,
  getLocalApiKey,
  getLocalBaseUrl,
  nearestEffort,
  resolveLocalReasoningEffort,
  writeLocalLlmSettings,
} from "~/server/generate/local-llm";
import { getModel, getProvider } from "~/server/generate/model-config";
import { resolvePricingModel } from "~/server/generate/pricing";

// never read a real .local-data/llm-settings.json
const dataDir = mkdtempSync(path.join(tmpdir(), "gitdiagram-llm-"));

beforeEach(() => {
  vi.stubEnv("LOCAL_DATA_DIR", dataDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(path.join(dataDir, "llm-settings.json"), { force: true });
});

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("local provider", () => {
  it("is selected by AI_PROVIDER=local and costs nothing", () => {
    vi.stubEnv("AI_PROVIDER", "local");
    vi.stubEnv("LOCAL_LLM_MODEL", "Qwen3.8-27B");
    expect(getProvider()).toBe("local");
    expect(getModel()).toBe("Qwen3.8-27B");
    expect(resolvePricingModel("Qwen3.8-27B")).toBe("local");
  });

  it("takes the Model dialog's settings over .env.local", () => {
    vi.stubEnv("AI_PROVIDER", "local");
    vi.stubEnv("LOCAL_LLM_BASE_URL", "http://127.0.0.1:8080/v1");
    vi.stubEnv("LOCAL_LLM_MODEL", "local");
    writeLocalLlmSettings({
      baseUrl: "https://openrouter.ai/api/v1/",
      model: "qwen/qwen3.8-27b:free",
    });
    expect(getLocalBaseUrl()).toBe("https://openrouter.ai/api/v1");
    expect(getModel()).toBe("qwen/qwen3.8-27b:free");
    // an empty field goes back to .env.local
    writeLocalLlmSettings({ baseUrl: "" });
    expect(getLocalBaseUrl()).toBe("http://127.0.0.1:8080/v1");
  });

  it("finds the key in settings, a named variable, or OPENROUTER_API_KEY", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-from-env");
    vi.stubEnv("MY_KEY", "sk-named");
    expect(getLocalApiKey()).toBe("local"); // local server: no key
    writeLocalLlmSettings({ baseUrl: "https://openrouter.ai/api/v1" });
    expect(getLocalApiKey()).toBe("sk-or-from-env");
    expect(describeLocalApiKey()).toEqual({
      source: "env",
      name: "OPENROUTER_API_KEY",
    });
    writeLocalLlmSettings({ apiKeyEnv: "MY_KEY" });
    expect(getLocalApiKey()).toBe("sk-named");
    writeLocalLlmSettings({ apiKey: "sk-typed" });
    expect(getLocalApiKey()).toBe("sk-typed");
    expect(describeLocalApiKey()).toEqual({ source: "settings" });
  });

  it("refuses settings that cannot be right", () => {
    expect(() => writeLocalLlmSettings({ baseUrl: "ftp://x" })).toThrow();
    expect(() => writeLocalLlmSettings({ apiKeyEnv: "not a name" })).toThrow();
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

  it("never probes a hosted API for /props", async () => {
    vi.stubEnv("LOCAL_LLM_BASE_URL", "https://openrouter.ai/api/v1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveLocalReasoningEffort("medium")).toBe("medium");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can be pinned or left to the server", async () => {
    vi.stubEnv("LOCAL_LLM_REASONING_EFFORT", "default");
    expect(await resolveLocalReasoningEffort("medium")).toBeUndefined();
  });
});
