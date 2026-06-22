'use client';

// React-UNCONTROLLED container for the keystroke-live body island, plus the
// runtime switch that activates it ONLY inside the TinaCMS admin iframe.
//
// ── THE removeChild BUG (why this file exists) ───────────────────────────────
// @tinacms/bridge's `swapIslandHtml` does `island.innerHTML = …` on the element
// carrying `[data-tina-island]`. In the first cut of this adapter that element
// was <DocsBody>, which React renders with `<MDX/>` as its child — i.e. React
// OWNS that subtree. The bridge tears those DOM nodes out and drops in its own.
// React's fiber tree still points at the ORIGINAL child nodes, so the next time
// React reconciles that subtree (most visibly on save, when `router.refresh()`
// re-runs the RSC and re-renders the body) it calls `removeChild` on a node it
// believes is its child but which the bridge already detached:
//
//   NotFoundError: Failed to execute 'removeChild' on 'Node':
//   The node to be removed is not a child of this node.
//
// ── THE FIX ──────────────────────────────────────────────────────────────────
// Give the bridge a node whose descendants React DOES NOT track:
//
//   * Outside the admin iframe (every real visitor, and the editor's first
//     paint) we render the REAL Fumadocs <MDX> passed as `children`. Production
//     rendering is therefore untouched and 100% faithful.
//
//   * Inside the admin iframe we swap to <IslandBody>: a single <div> populated
//     via `dangerouslySetInnerHTML` with a value FROZEN at first render. React's
//     contract for dangerouslySetInnerHTML is (1) it never walks/reconciles the
//     descendants — they are opaque, so React never calls removeChild inside the
//     div; and (2) it only rewrites the DOM when `__html` CHANGES. We keep
//     handing back the same frozen string, so every later React render (incl.
//     the post-save refresh) is a DOM no-op for this node and the bridge's live
//     innerHTML is never clobbered by React.
//
// The bridge thus mutates a subtree React has fully ceded — no reconciliation
// crosses the boundary ⇒ no removeChild, ever. Editing and saving repeatedly is
// safe.
//
// ── SAVE ─────────────────────────────────────────────────────────────────────
// On save the RSC re-runs (router.refresh) and the parent passes a new
// `remountKey` (a hash of the freshly-SAVED content). The keyed <IslandBody>
// REMOUNTS: React throws away the old DOM node wholesale and mounts a fresh one
// seeded with the new SSR HTML — a clean DOM that exactly matches the saved
// render, with no torn nodes to remove. (Belt-and-suspenders: the uncontrolled
// subtree already makes the swap safe; the remount just guarantees the preview
// can't drift from the saved render after a save.)

import { useRef, useSyncExternalStore } from 'react';

export interface TinaIslandBodyProps {
  /** Island endpoint URL — the bridge reads it off `data-tina-island`. */
  islandUrl: string;
  /**
   * SSR markup of the SAVED body (compiled via the SAME preview component map
   * the island route uses), seeding the first editor frame so there is no flash
   * before the bridge primes.
   */
  initialHtml: string;
  /**
   * Stable per-save token (e.g. a content hash of the saved body). Changing it
   * remounts the live container after a save so it re-seeds from saved truth.
   */
  remountKey?: string;
  /** Coarse "click body to edit" marker (the body rich-text field path). */
  bodyField?: string;
  /** Classes to match Fumadocs prose styling on the live wrapper. */
  className?: string;
  /**
   * The REAL Fumadocs body (`<MDX components=… />`). Shown to every visitor and
   * on the editor's first paint; replaced by the live island only inside the
   * admin iframe.
   */
  children: React.ReactNode;
}

// `true` only when running inside the TinaCMS admin iframe (cross-window). Read
// via useSyncExternalStore so SSR + first client render both see `false` (→ the
// real <MDX>), then we re-render to `true` inside the iframe with no hydration
// mismatch. The subscribe is a no-op: iframe-ness never changes for a document.
const emptySubscribe = () => () => {};
const inAdminIframe = () =>
  typeof window !== 'undefined' && window.parent !== window;

function IslandBody({
  islandUrl,
  initialHtml,
  bodyField,
  className,
}: Omit<TinaIslandBodyProps, 'children' | 'remountKey'>) {
  // Freeze the seed at first render of THIS instance. A new save changes the
  // parent's `key`, mounting a fresh instance that captures the new seed here.
  const frozen = useRef(initialHtml);
  return (
    <div
      data-tina-island={islandUrl}
      data-tina-field={bodyField}
      className={className}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: frozen.current }}
    />
  );
}

export function TinaIslandBody({
  children,
  remountKey,
  ...islandProps
}: TinaIslandBodyProps) {
  const isAdmin = useSyncExternalStore(
    emptySubscribe,
    inAdminIframe, // client snapshot
    () => false, // server snapshot
  );

  if (!isAdmin) return <>{children}</>;
  return <IslandBody key={remountKey} {...islandProps} />;
}
