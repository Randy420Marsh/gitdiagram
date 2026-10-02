import Link from "next/link";

import { listLocalRepositories } from "~/server/generate/local-repo";
import { isLocalMode } from "~/server/storage/config";

/** Local mode's home-page list: every folder that opens as /local/<name>. */
export async function LocalFolders() {
  if (!isLocalMode()) return null;
  const folders = await listLocalRepositories();
  return (
    <section className="mx-auto mt-10 max-w-3xl px-2 text-center">
      <h2 className="text-sm font-semibold tracking-wide text-[hsl(var(--neo-soft-text))] uppercase">
        Local folders
      </h2>
      {folders.length ? (
        <ul className="mt-3 flex flex-wrap justify-center gap-2">
          {folders.map((folder) => (
            <li key={folder.name}>
              <Link
                href={`/local/${encodeURIComponent(folder.name.toLowerCase())}`}
                title={folder.path}
                className="browse-muted-button inline-flex min-h-[32px] items-center rounded-full px-3 py-1 text-sm font-medium"
              >
                {folder.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[hsl(var(--neo-soft-text))]">
          Set LOCAL_REPO_ROOTS in .env.local to diagram folders on this machine,
          or type local/&lt;folder&gt; above.
        </p>
      )}
    </section>
  );
}
