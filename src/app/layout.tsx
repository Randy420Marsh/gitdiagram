import "~/styles/globals.css";

import { GeistSans } from "geist/font/sans";
import { type Metadata } from "next";
import { Header } from "~/components/header";
import { LivePresence } from "~/components/live-presence";
import { CSPostHogProvider } from "./providers";
import { SITE_URL } from "~/lib/site";
import { chunkReloadScript } from "~/lib/chunk-reload";

// A local app (LOCAL.md): nothing here is meant for search engines.
export const metadata: Metadata = {
  title: "GitDiagram",
  description:
    "Turn a local folder or a Git repository into an interactive architecture diagram.",
  metadataBase: new URL(SITE_URL),
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable}`}
    >
      <head>
        {/* Before any chunk loads: reload once if one fails (see chunk-reload.ts). */}
        <script dangerouslySetInnerHTML={{ __html: chunkReloadScript }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <CSPostHogProvider>
          <Header />
          <div className="flex-grow">{children}</div>
          <LivePresence />
        </CSPostHogProvider>
      </body>
    </html>
  );
}
