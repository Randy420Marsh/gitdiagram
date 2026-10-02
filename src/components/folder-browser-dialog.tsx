"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUp, Folder, FolderGit2, HardDrive } from "lucide-react";

import controls from "./generation/workspace.module.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

interface Listing {
  ok: boolean;
  error?: string;
  path: string | null;
  parent: string | null;
  git: boolean;
  entries: Array<{ name: string; path: string; git?: boolean }>;
}

/**
 * Local mode's folder picker: walks the server's disk (drives on Windows, /
 * on Linux) through /api/local/browse and hands back the chosen path.
 */
export function FolderBrowserDialog({
  isOpen,
  initialPath,
  onClose,
  onSelect,
}: {
  isOpen: boolean;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const open = useCallback(async (folder: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/local/browse?path=${encodeURIComponent(folder)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as Listing;
      if (!data.ok) {
        setError(data.error ?? "Cannot open that folder.");
        return;
      }
      setListing(data);
      setTyped(data.path ?? "");
    } catch {
      setError("Cannot reach the GitDiagram server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void open(initialPath ?? "");
  }, [initialPath, isOpen, open]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className={`neo-panel ${controls.controlsTheme} flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col rounded-lg p-5 sm:max-w-xl sm:p-6`}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="pr-6 text-xl font-bold">
            Choose a folder
          </DialogTitle>
          <DialogDescription className="text-sm text-neutral-700 dark:text-neutral-300">
            Any folder on this machine. Folders with a git icon are
            repositories; their .gitignore is honored.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void open(typed);
          }}
        >
          <Input
            aria-label="Folder path"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="C:\Projects or /home/me/projects"
            spellCheck={false}
            className="neo-input h-10 min-w-0 flex-1 rounded-md px-3 text-sm"
          />
          <button type="submit" className={controls.actionButton}>
            Go
          </button>
        </form>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            disabled={!listing?.path}
            onClick={() => void open(listing?.parent ?? "")}
            className={`${controls.actionButton} disabled:opacity-50`}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
            Up
          </button>
          <span className="min-w-0 truncate font-mono text-xs">
            {listing?.path ?? "This computer"}
          </span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <ul
          aria-busy={loading}
          className="min-h-48 flex-1 overflow-y-auto rounded-md border-2 border-black p-1 dark:border-black"
        >
          {listing?.entries.length === 0 && (
            <li className="p-3 text-sm text-neutral-600 dark:text-neutral-400">
              No sub-folders.
            </li>
          )}
          {listing?.entries.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                onClick={() => void open(entry.path)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-purple-200 dark:hover:bg-[hsl(var(--neo-panel-muted))]"
              >
                {listing.path === null ? (
                  <HardDrive className="h-4 w-4 shrink-0" aria-hidden="true" />
                ) : entry.git ? (
                  <FolderGit2
                    className="h-4 w-4 shrink-0 text-purple-700 dark:text-purple-300"
                    aria-label="git repository"
                  />
                ) : (
                  <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span className="truncate">{entry.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {listing?.git && (
            <span className="mr-auto text-xs text-neutral-700 dark:text-neutral-300">
              This folder is a git repository.
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className={controls.actionButton}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!listing?.path}
            onClick={() => listing?.path && onSelect(listing.path)}
            className={`${controls.actionButton} ${controls.primary} disabled:opacity-50`}
          >
            Use this folder
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
