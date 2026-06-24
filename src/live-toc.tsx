'use client';

// LIVE table-of-contents wiring for the TinaCMS admin iframe. Fumadocs renders the
// "On this page" sidebar from the `toc` prop on <DocsPage>, which the server page
// fills ONCE from `page.data.toc`. That snapshot can't see headings the editor
// adds/edits live. This module lets the keystroke-live body (live-body.tsx) push a
// freshly-compiled toc back UP to a stateful <DocsPage>, so the sidebar tracks
// heading edits in real time.
//
// ── Shape (smallest correct version) ──────────────────────────────────────────
//   * <TinaDocsPage> is a thin CLIENT wrapper the page drops in place of
//     <DocsPage>. It owns `useState(initialToc)` and renders <DocsPage toc={live}>.
//     It publishes its `setToc` through TocContext.
//   * <TinaLiveBody> (a descendant, deep inside <DocsBody>) reads that setter from
//     context and calls it after each successful compile. Because it's a
//     descendant — not a direct child — a context is the clean way to push state
//     up without threading a function prop through the server-rendered children.
//
// ── Production is untouched ───────────────────────────────────────────────────
// Outside the admin iframe there is no live body and no `updateData`, so `setToc`
// is never called: <DocsPage> just shows `initialToc` exactly as before. The only
// change for real visitors is one extra (cheap) client wrapper holding a useState
// that never updates. The context default is a no-op, so a <TinaLiveBody> used
// WITHOUT <TinaDocsPage> simply skips the toc push (no crash).

import { createContext, useContext, useState } from 'react';
import {
  DocsPage,
  type DocsPageProps,
} from 'fumadocs-ui/layouts/docs/page';

/** A TOC item array (Fumadocs `TOCItemType[]`), kept loose to avoid a type dep. */
export type LiveToc = NonNullable<DocsPageProps['toc']>;

/**
 * Lets a descendant <TinaLiveBody> hand its freshly-compiled toc to the nearest
 * <TinaDocsPage>. Default is a no-op so consumers outside a provider are safe.
 */
export const TocContext = createContext<(toc: LiveToc) => void>(() => {});

/** Read the toc setter (no-op when there's no <TinaDocsPage> above). */
export function useSetLiveToc(): (toc: LiveToc) => void {
  return useContext(TocContext);
}

/**
 * Drop-in client replacement for Fumadocs' <DocsPage> that makes `toc` live.
 * Pass the server's `page.data.toc` as `toc` (the initial value); everything else
 * (children, `full`, …) forwards verbatim. Inside the admin iframe, a descendant
 * <TinaLiveBody> pushes new tocs in via context and the sidebar re-renders.
 */
export function TinaDocsPage({ toc: initialToc, children, ...rest }: DocsPageProps) {
  // Seed from the server snapshot; the live body overwrites this on heading edits.
  const [toc, setToc] = useState<DocsPageProps['toc']>(initialToc);
  return (
    <TocContext.Provider value={setToc as (toc: LiveToc) => void}>
      <DocsPage toc={toc} {...rest}>
        {children}
      </DocsPage>
    </TocContext.Provider>
  );
}
