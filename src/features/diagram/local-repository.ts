/**
 * Local mode (NEXT_PUBLIC_GITDIAGRAM_LOCAL=1, see LOCAL.md): /local/<name> is
 * a folder on this machine. It has no GitHub page, so nothing links there.
 */
export function isLocalRepositoryOwner(
  owner: string | null | undefined,
): boolean {
  return (
    process.env.NEXT_PUBLIC_GITDIAGRAM_LOCAL === "1" &&
    owner?.toLowerCase() === "local"
  );
}
