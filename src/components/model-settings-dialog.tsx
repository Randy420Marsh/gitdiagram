"use client";

import { useCallback, useEffect, useId, useState } from "react";

import controls from "./generation/workspace.module.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

interface Snapshot {
  ok: boolean;
  error?: string;
  effective: {
    baseUrl: string;
    model: string;
    reasoningEffort: string;
    apiKey: { source: "settings" | "env" | "none"; name?: string };
  };
  saved: {
    baseUrl: string;
    model: string;
    apiKeyEnv: string;
    reasoningEffort: string;
    hasApiKey: boolean;
  };
}

type KeyMode = "none" | "env" | "key";

const PRESETS = [
  { label: "Local llama-server", baseUrl: "http://127.0.0.1:8080/v1" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
];
const EFFORTS = [
  { value: "", label: "As in .env.local" },
  { value: "app", label: "Per stage (low / medium), nearest model level" },
  { value: "default", label: "Send none (server default)" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
];
const INPUT_CLASS =
  "neo-input h-11 rounded-md px-3 py-2 text-base placeholder:font-normal placeholder:text-gray-600 dark:placeholder:text-neutral-400";

/**
 * Local mode's model endpoint: a llama-server on this machine or any
 * OpenAI-compatible API (OpenRouter). Saved on the server in
 * .local-data/llm-settings.json; empty fields fall back to .env.local.
 */
export function ModelSettingsDialog({
  isOpen,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** after Save closes the dialog, e.g. to retry a failed generation */
  onSaved?: () => void | Promise<void>;
}) {
  const id = useId();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [keyMode, setKeyMode] = useState<KeyMode>("none");
  const [keyEnv, setKeyEnv] = useState("OPENROUTER_API_KEY");
  const [keyValue, setKeyValue] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  const load = useCallback((data: Snapshot) => {
    setSnapshot(data);
    setBaseUrl(data.saved.baseUrl);
    setModel(data.saved.model);
    setEffort(data.saved.reasoningEffort);
    setKeyMode(
      data.saved.hasApiKey ? "key" : data.saved.apiKeyEnv ? "env" : "none",
    );
    if (data.saved.apiKeyEnv) setKeyEnv(data.saved.apiKeyEnv);
    setKeyValue("");
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setStatus(null);
    void fetch("/api/local/llm-settings", { cache: "no-store" })
      .then((response) => response.json() as Promise<Snapshot>)
      .then((data) => {
        if (data.ok) load(data);
        else setStatus({ ok: false, text: data.error ?? "Cannot load." });
      })
      .catch(() =>
        setStatus({ ok: false, text: "Cannot reach the GitDiagram server." }),
      );
  }, [isOpen, load]);

  const save = async (): Promise<boolean> => {
    const body: Record<string, string> = {
      baseUrl,
      model,
      reasoningEffort: effort,
      apiKeyEnv: keyMode === "env" ? keyEnv : "",
    };
    if (keyMode !== "key") body.apiKey = "";
    else if (keyValue.trim()) body.apiKey = keyValue.trim();
    const response = await fetch("/api/local/llm-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as Snapshot;
    if (!data.ok) {
      setStatus({ ok: false, text: data.error ?? "Could not save." });
      return false;
    }
    load(data);
    return true;
  };

  const run = async (test: boolean) => {
    setPending(true);
    setStatus(null);
    try {
      if (!(await save())) return;
      if (!test) {
        onClose();
        await onSaved?.();
        return;
      }
      const response = await fetch("/api/local/llm-settings/test", {
        method: "POST",
      });
      const result = (await response.json()) as {
        ok: boolean;
        status?: number;
        models?: string[];
        error?: string;
      };
      setModels(result.models ?? []);
      setStatus(
        result.ok
          ? {
              ok: true,
              text: `Saved. The endpoint answered with ${result.models?.length ?? 0} model(s).`,
            }
          : {
              ok: false,
              text: `Saved, but the endpoint did not answer: ${result.status ?? ""} ${result.error ?? ""}`.trim(),
            },
      );
    } catch {
      setStatus({ ok: false, text: "Request failed." });
    } finally {
      setPending(false);
    }
  };

  const effective = snapshot?.effective;
  const keyNote = !effective
    ? ""
    : effective.apiKey.source === "settings"
      ? "A key is saved."
      : effective.apiKey.source === "env"
        ? `Using ${effective.apiKey.name}.`
        : effective.apiKey.name
          ? `${effective.apiKey.name} is not set.`
          : "No key (fine for a local llama-server).";

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={`neo-panel ${controls.controlsTheme} max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg p-5 sm:max-w-lg sm:p-6`}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="pr-6 text-xl font-bold">Model</DialogTitle>
          <DialogDescription className="text-sm text-neutral-700 dark:text-neutral-300">
            Any OpenAI-compatible endpoint with the Responses API: your
            llama-server, or a hosted API such as OpenRouter. Empty fields use
            .env.local.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(false);
          }}
        >
          <div className="space-y-2">
            <label htmlFor={`${id}-url`} className="block text-sm font-bold">
              Endpoint
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setBaseUrl(preset.baseUrl)}
                  className={`${controls.actionButton} text-sm`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <Input
              id={`${id}-url`}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={effective?.baseUrl ?? "http://127.0.0.1:8080/v1"}
              spellCheck={false}
              className={INPUT_CLASS}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-model`} className="block text-sm font-bold">
              Model
            </label>
            <Input
              id={`${id}-model`}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={effective?.model ?? "local"}
              list={`${id}-models`}
              spellCheck={false}
              className={INPUT_CLASS}
            />
            <datalist id={`${id}-models`}>
              {models.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <p className="text-xs text-neutral-700 dark:text-neutral-300">
              A single-model llama-server ignores the name. For OpenRouter use
              its model id, e.g. qwen/qwen3.8-27b:free.
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold">API key</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["none", "None"],
                  ["env", "Environment variable"],
                  ["key", "Key"],
                ] as const
              ).map(([mode, label]) => (
                <label key={mode} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${id}-keymode`}
                    checked={keyMode === mode}
                    onChange={() => setKeyMode(mode)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {keyMode === "env" && (
              <Input
                aria-label="Environment variable name"
                value={keyEnv}
                onChange={(event) => setKeyEnv(event.target.value)}
                spellCheck={false}
                className={INPUT_CLASS}
              />
            )}
            {keyMode === "key" && (
              <Input
                aria-label="API key"
                type="password"
                autoComplete="off"
                value={keyValue}
                onChange={(event) => setKeyValue(event.target.value)}
                placeholder={
                  snapshot?.saved.hasApiKey
                    ? "Saved — paste a new key to replace it"
                    : "sk-..."
                }
                className={`ph-no-capture ${INPUT_CLASS}`}
              />
            )}
            <p className="text-xs text-neutral-700 dark:text-neutral-300">
              {keyNote} Keys stay on this machine, in .local-data.
            </p>
          </fieldset>
          <div className="space-y-2">
            <label htmlFor={`${id}-effort`} className="block text-sm font-bold">
              Reasoning effort
            </label>
            <select
              id={`${id}-effort`}
              value={effort}
              onChange={(event) => setEffort(event.target.value)}
              className={`${INPUT_CLASS} w-full`}
            >
              {EFFORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {status && (
            <p
              role={status.ok ? "status" : "alert"}
              className={`text-sm font-medium ${status.ok ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}
            >
              {status.text}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className={controls.actionButton}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void run(true)}
              className={controls.actionButton}
            >
              {pending ? "Working..." : "Save & test"}
            </button>
            <button
              type="submit"
              disabled={pending}
              className={`${controls.actionButton} ${controls.primary}`}
            >
              Save
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
