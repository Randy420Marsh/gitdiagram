# GitDiagram local edition

Runs GitDiagram on one machine with no hosted services: diagrams of **folders on this machine**
or GitHub repositories, made by your own [llama.cpp](https://github.com/ggml-org/llama.cpp)
`llama-server` or any OpenAI-compatible API you choose (OpenRouter, for example), stored on disk.
No OpenAI, Cloudflare R2 or Upstash account is needed. The hosted site's sponsor slots, example
repositories, credits and GitHub star count are removed.

## Quick start

1. Start a model server, for example `llama-server` on port 8080 with a capable model (tested:
   Qwen3.8 27B, `-c 100000`). Or skip this and use a hosted API (see "The model").
2. Run the launcher:

   ```bat
   run.bat                 :: Windows
   ```

   ```bash
   ./run.sh                # Linux, macOS, Git Bash
   ```

   The first run installs bun (the version the project pins, 1.3.14), the dependencies and
   `.env.local` (copied from `.env.local.example`). Later runs skip that and start at once.
3. Open <http://localhost:3000> and type a folder path (`C:\Projects\app`, `/home/me/app`), a
   GitHub URL or `owner/repo`, or press **Browse** to pick a folder.

| Command | What it does |
|---|---|
| `run.bat` / `./run.sh` | dev server with hot reload |
| `--prod` | production build (first time only), then `next start`: faster pages |
| `--rebuild` | production build again (after changing the code), then `next start` |
| `--port 3100` | another port, any mode |
| `--lan` | also serve to the network (see "Security") |
| `--setup-only` | install what is missing and exit |

Setup is repeated only when `bun.lock` changes (stamp file `node_modules/.bun-lock.stamp`).
The launchers also warn when no `llama-server` answers at `LOCAL_LLM_BASE_URL`; stored
diagrams still open without one. They set `NEXT_TELEMETRY_DISABLED=1`.

## Folders on this machine

- **Type or paste a path** into the home page's field — Windows (`C:\Projects\app`,
  `\\server\share\repo`) or Linux (`/home/me/project`, `~/project`) — and press Diagram.
- **Browse** walks the disk from the drives (Windows) or `/` (Linux) and your home folder; folders
  that are git repositories are marked. "Use this folder" puts the path into the field.
- A folder gets a stable address, `http://localhost:3000/local/<name>`. Folders directly inside a
  `LOCAL_REPO_ROOTS` root keep their own name and are listed on the home page; any other folder
  is remembered in `.local-data/local-repos.json` under its name made URL-safe (`My App!` becomes
  `My-App`, a second `demo` becomes `demo-2`).

How a folder is read:

- A git work tree is listed with `git ls-files --cached --others --exclude-standard`, so
  `.gitignore` is honored and untracked files are included. Other folders are walked, skipping
  `.git`, `node_modules`, `venv`, `build`, `dist`, `target`, `out` and the like.
- The same filters as for GitHub apply (images, lock files, minified bundles and so on are left
  out), with at most 100,000 entries. Source excerpts are read from disk.
- A local diagram has no links: there is no GitHub page to open.

GitHub repositories work as before (`/owner/repo`): public ones without any key, private ones
with a token (**Private Repos**). `GITHUB_PAT` raises GitHub's rate limit of 60 requests an hour.

## The model

**Model** in the header sets the endpoint, model, key and reasoning effort; **Save & test** checks
that the endpoint answers and lists its models. The settings are kept on this machine in
`.local-data/llm-settings.json` and take precedence over `.env.local`; an empty field falls back
to `.env.local`.

| Endpoint | Base URL | Model | Key |
|---|---|---|---|
| your llama-server | `http://127.0.0.1:8080/v1` | ignored (one model) | none |
| OpenRouter | `https://openrouter.ai/api/v1` | e.g. `qwen/qwen3.8-27b:free` | `OPENROUTER_API_KEY` (read automatically for openrouter.ai), another variable by name, or pasted |
| any OpenAI-compatible API with the Responses API | its `/v1` URL | its model id | as it requires |

GitDiagram talks to the endpoint through the OpenAI **Responses API** (`/v1/responses`):

- **Structured output.** The graph stage sends a strict JSON schema in `text.format`. The server
  must constrain the output to it; `llama-server` needs a build that maps `text.format` to
  `response_format` (the video-audio-pipeline fork of llama.cpp has it, in
  `tools/server/server-chat.cpp`).
- **Reasoning effort.** GitDiagram asks for `low` or `medium` per stage. A llama.cpp chat template
  accepts only its own levels and raises on others, so for a server on this machine or the LAN the
  level sent is the nearest one it reports in `/props` (`reasoning_efforts`; Qwen3.8: low /
  medium / xhigh). Hosted APIs get the level as asked. The Model dialog can pin one level or send
  none.
- **No output cap.** GitDiagram never sends `max_output_tokens`, so reasoning and output finish in
  full. The prompt is bounded (file tree, README, up to 48k characters of source); the llama.cpp
  repository took about 29k input tokens, so a context of 64k or more is comfortable.
- **Cost** shows as $0 (the app cannot price arbitrary models).

## Configuration (`.env.local`)

| Variable | Default | Meaning |
|---|---|---|
| `GITDIAGRAM_LOCAL` | — | `1` turns local mode on: storage on disk, Redis in process |
| `NEXT_PUBLIC_GITDIAGRAM_LOCAL` | — | `1`: the browser side offers folders and knows `/local/...` has no GitHub page |
| `AI_PROVIDER` | `openai` | `local` uses the endpoint below (or the Model dialog's) |
| `LOCAL_LLM_BASE_URL` | `http://127.0.0.1:8080/v1` | the endpoint's OpenAI-compatible base URL |
| `LOCAL_LLM_MODEL` | `local` | model id; a single-model llama-server ignores it |
| `LOCAL_LLM_API_KEY` | — | the key, when the endpoint needs one |
| `OPENROUTER_API_KEY` | — | used for an openrouter.ai endpoint when no other key is set |
| `LOCAL_LLM_REASONING_EFFORT` | `app` | `app`: per stage, mapped to the model's levels; a level name: that level always; `default`: none |
| `LOCAL_LLM_TIMEOUT_MS` | `600000` | how long one model request may take |
| `LOCAL_LLM_MAX_RETRIES` | `3` | retries (with backoff, honoring `Retry-After`) when the endpoint answers 429/5xx before any output; free OpenRouter models are rate-limited in bursts |
| `LOCAL_REPO_ROOTS` | — | folders whose sub-folders are listed on the home page (`;` between several on Windows, `:` on Linux) |
| `LOCAL_DATA_DIR` | `.local-data` | where diagrams, settings, the folder list and the per-install secret are kept |

## Security

Folder browsing, folder registration and the Model dialog can read the disk and choose where
requests go, so they answer only the browser on this machine:

- the launchers bind the server to `127.0.0.1` (not reachable from the network);
- the routes answer only requests addressed to `localhost` / `127.0.0.1` / `[::1]`, which also
  stops a web page from reaching them through DNS rebinding, and changes must come from the app's
  own pages (same origin);
- `--lan` serves the app to the network for viewing and generating, and turns these three off
  (`GITDIAGRAM_LAN=1`), because a forged Host header could otherwise pass.

Keys saved in the Model dialog stay in `.local-data/llm-settings.json` and are never sent to the
browser.

## What runs where

| Hosted (upstream) | Local edition |
|---|---|
| OpenAI / OpenRouter (fixed) | the endpoint you choose (`src/server/generate/local-llm.ts`) |
| Cloudflare R2 | files under `.local-data/objects/<bucket>/` (`src/server/storage/local-object-store.ts`) |
| Upstash Redis | in-process Redis with Lua scripting, `ioredis-mock` (`src/server/storage/local-redis.ts`) |
| `CACHE_KEY_SECRET` | a random secret made once, `.local-data/cache-key-secret` |
| GitHub repositories only | also folders on this machine (`src/server/generate/local-repo.ts`) |

Redis holds only short-lived state (rate limits, locks, cancellation flags, caches), so losing it
on restart does no harm. Diagrams persist in `.local-data`; delete that folder to start over.

Explainer videos, the operator dashboard (`/admin`), paid videos, live presence and AI-visibility
checks stay off: they need their own keys and flags, none of which are set. Network calls that
remain: the model endpoint you chose, and the GitHub API and raw file CDN for GitHub repositories.

## Tests

```bash
bun run test src/server/storage/local-mode.test.ts src/server/generate/local-llm.test.ts \
             src/server/generate/local-repo.test.ts src/server/http/local-only.test.ts
bun run test                                   # everything
node node_modules/typescript-7/bin/tsc --noEmit  # typecheck (bun cannot run the bin on Windows)
```

On Windows six upstream test files fail regardless of local mode: the `*.redis.test.ts` files
need a `redis-server` binary, the video-storage tests hit Windows file locking, and one ffmpeg
voice test fails.
