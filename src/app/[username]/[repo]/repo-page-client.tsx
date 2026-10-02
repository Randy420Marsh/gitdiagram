"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { ExternalLink, LockKeyhole, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { DiagramStateResponse } from "~/features/diagram/types";
import { RepositoryWorkspace } from "~/components/generation/repository-workspace";
import { loadDiagramRenderer } from "~/components/generation/load-diagram-renderer";
import { useDiagram } from "~/hooks/useDiagram";
import { useGitHubConnectResult } from "~/hooks/use-github-connect-result";
import { usePublicDiagram } from "~/hooks/use-public-diagram";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { VIDEOS_ENABLED } from "~/lib/video-flag";
import { githubAccessTitle } from "~/features/diagram/github-access";
import { isLocalRepositoryOwner } from "~/features/diagram/local-repository";
import controls from "~/components/generation/workspace.module.css";

const ExplainerVideo = dynamic(
  () =>
    import("~/components/explainer/explainer-video").then(
      (module) => module.ExplainerVideo,
    ),
  { ssr: false },
);

const VideoInfo = dynamic(
  () =>
    import("~/components/explainer/video-info").then(
      (module) => module.VideoInfo,
    ),
  { ssr: false },
);

const PrivateReposDialog = dynamic(
  () =>
    import("~/components/private-repos-dialog").then(
      (module) => module.PrivateReposDialog,
    ),
  { ssr: false },
);

const ModelSettingsDialog = dynamic(
  () =>
    import("~/components/model-settings-dialog").then(
      (module) => module.ModelSettingsDialog,
    ),
  { ssr: false },
);

// A failure the model endpoint can explain: wrong URL, key, model or a limit.
const MODEL_ERROR =
  /api key|model|provider|upstream|endpoint|llama|rate limit/i;

type RepoPageClientProps = {
  username: string;
  repo: string;
  initialState?: DiagramStateResponse | null;
  initialStateIsAuthoritative?: boolean;
  /** Server-rendered text of the stored diagram, shown under the workspace. */
  readout?: ReactNode;
};

export default function RepoPageClient({
  username,
  repo,
  initialState = null,
  initialStateIsAuthoritative = false,
  readout,
}: RepoPageClientProps) {
  const [showGithubAccess, setShowGithubAccess] = useState(false);
  const [connectResult, dismissConnectResult] = useGitHubConnectResult("repo");
  const normalizedUsername = username.toLowerCase();
  const normalizedRepo = repo.toLowerCase();
  const repository = `${normalizedUsername}/${normalizedRepo}`;
  const {
    diagram,
    error,
    loading,
    lastGenerated,
    showApiKeyDialog,
    handleApiKeySaved,
    handleCloseApiKeyDialog,
    handleOpenApiKeyDialog,
    handleRegenerate,
    handleCancel,
    handleDiagramRenderError,
    state,
  } = useDiagram(
    normalizedUsername,
    normalizedRepo,
    initialState,
    initialStateIsAuthoritative,
  );
  const hasDiagram = Boolean(diagram);
  const publicDiagram = usePublicDiagram({
    owner: normalizedUsername,
    repo: normalizedRepo,
    ready: hasDiagram && state.status === "complete",
    knownPublicAt: initialStateIsAuthoritative
      ? initialState?.lastSuccessfulAt
      : null,
  });
  // the Model dialog (endpoint, key, model) is the fix for these
  const showApiKeyCta =
    state.errorCode === "RATE_LIMITED" ||
    MODEL_ERROR.test(error ?? "") ||
    MODEL_ERROR.test(state.error ?? "");
  const showGithubAccessCta = Boolean(githubAccessTitle(state.errorCode));

  useEffect(() => {
    if (hasDiagram || loading) void loadDiagramRenderer();
  }, [hasDiagram, loading]);
  // Back from "Continue with GitHub": the page load already retries the
  // diagram with the new sign-in; a sign-in that did not finish reopens the
  // dialog with the reason.
  useEffect(() => {
    if (connectResult?.status === "connected") {
      toast.success("GitHub connected");
    } else if (connectResult?.status === "failed") {
      setShowGithubAccess(true);
    }
  }, [connectResult]);
  useEffect(() => {
    if (!state.persistenceWarning) return;
    toast.warning("Diagram generated, but not saved", {
      description: state.persistenceWarning,
      duration: 8_000,
    });
  }, [state.persistenceWarning]);

  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={300}>
      <main>
        <RepositoryWorkspace
          repository={repository}
          state={state}
          loading={loading}
          lastGenerated={lastGenerated}
          onRegenerate={() => void handleRegenerate()}
          onCancel={handleCancel}
          onRenderError={handleDiagramRenderError}
          regenerateDisabled={false}
          readme={publicDiagram ?? undefined}
          video={
            VIDEOS_ENABLED ? (
              <ExplainerVideo
                username={normalizedUsername}
                repo={normalizedRepo}
              />
            ) : undefined
          }
          info={
            VIDEOS_ENABLED ? (
              <VideoInfo username={normalizedUsername} repo={normalizedRepo} />
            ) : undefined
          }
          recovery={
            <>
              {showGithubAccessCta && (
                <button
                  type="button"
                  onClick={() => setShowGithubAccess(true)}
                  className={`${controls.actionButton} ${controls.primary}`}
                >
                  <LockKeyhole size={14} aria-hidden="true" />
                  Add GitHub access
                </button>
              )}
              {showApiKeyCta && (
                <button
                  type="button"
                  onClick={handleOpenApiKeyDialog}
                  className={`${controls.actionButton} ${controls.primary}`}
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  Model settings
                </button>
              )}
              {!isLocalRepositoryOwner(username) && (
                <a
                  href={`https://github.com/${repository}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={controls.actionButton}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open repository on GitHub
                </a>
              )}
            </>
          }
        />
        {readout}
        {showApiKeyDialog && (
          <ModelSettingsDialog
            isOpen
            onClose={handleCloseApiKeyDialog}
            onSaved={handleApiKeySaved}
          />
        )}
        {showGithubAccess && (
          <PrivateReposDialog
            isOpen
            repository={repository}
            connectError={
              connectResult?.status === "failed"
                ? connectResult.reason
                : undefined
            }
            onClose={() => {
              setShowGithubAccess(false);
              dismissConnectResult();
            }}
            onSaved={() => void handleRegenerate()}
          />
        )}
        <Toaster />
      </main>
    </TooltipProvider>
  );
}
