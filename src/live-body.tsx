'use client';

// The keystroke-live doc body for the TinaCMS admin iframe — rendering the REAL
// Fumadocs components (Card, Tabs, …) LIVE on every edit, with NO placeholder.
//
// ── How it works ─────────────────────────────────────────────────────────────
// The body render stays CLIENT-side and React-owned the entire time:
//
//   * Outside the admin iframe (every real visitor + the editor's first paint):
//     render the REAL Fumadocs <MDX> passed as `children`. Production is 100%
//     untouched — this whole client path is dormant.
//
//   * Inside the admin iframe: listen for the bridge's `updateData` overlay,
//     serialize THIS doc's body AST back to MDX, compile it client-side via
//     @fumadocs/mdx-remote, and render the resulting `<Body components={REAL}/>`.
//     React owns this subtree the entire time.
//
// ── Why NO `data-tina-island` here (kills the removeChild bug by design) ──────
// @tinacms/bridge's built-in island-refresh does `island.innerHTML = …` on any
// `[data-tina-island]` node, tearing out DOM that React's fiber still tracks →
// the classic `removeChild` NotFoundError on the next React render (and the
// server render behind it can't run Fumadocs' `'use client'` components anyway,
// so it could only ever swap in placeholders). We never set that attribute, so
// the bridge NEVER innerHTML-swaps our subtree; React alone mutates it via normal
// reconciliation. We DO keep `data-tina-field` for click-to-edit. Because the
// bridge can't live-refresh us, the body update is driven by our own `updateData`
// listener instead (below).

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MDXComponents } from 'mdx/types';
import { serializeMDX } from '@tinacms/mdx';
import { compileFumadocsMDXClient } from './client-compile';
import { fumadocsTemplates } from './templates';
import { useSetLiveToc, type LiveToc } from './live-toc';
// Wraps the REAL component map in per-component error boundaries + Suspense and
// guards the three known insert-time crashers (img / GithubInfo / InlineTOC), so
// a half-filled block degrades to a placeholder instead of white-screening the
// preview. PREVIEW-ONLY: applied to the in-iframe live <Body> below; the
// outside-iframe path keeps rendering the unmodified real <MDX> children.
import { toPreviewComponents } from './live-error-boundary';

export interface TinaLiveBodyProps {
  /** The bridge form id; we only react to `updateData` for THIS form. */
  formId: string;
  /** Tina collection name (e.g. "docs"). Default "docs". */
  collection?: string;
  /** Click-to-edit marker for the body rich-text field (`<id>---<col>.body`). */
  bodyField?: string;
  /** Classes to match Fumadocs prose styling on the live wrapper. */
  className?: string;
  /**
   * Returns the REAL Fumadocs component map (e.g. `() => getMDXComponents()`).
   * These are the actual `'use client'` components — NOT preview placeholders.
   */
  getComponents: () => MDXComponents;
  /** Debounce for the compile after each keystroke. Default 150ms. */
  debounceMs?: number;
  /**
   * Receives the freshly-compiled table of contents after each successful live
   * compile, so a stateful <DocsPage> can re-render its "On this page" sidebar as
   * headings are edited. Optional: when omitted, the toc is pushed to the nearest
   * <TinaDocsPage> via context instead (see live-toc.tsx). Pass it explicitly only
   * if you manage toc state yourself.
   */
  onToc?: (toc: LiveToc) => void;
  /**
   * The REAL Fumadocs body (`<MDX components=… />`). Shown to every visitor, on
   * the editor's first paint, and until the first overlay arrives.
   */
  children: React.ReactNode;
}

// `true` only inside the TinaCMS admin iframe (cross-window). Read via
// useSyncExternalStore so SSR + first client render both see `false` (→ real
// <MDX>), then we re-render to `true` inside the iframe with no hydration
// mismatch. iframe-ness never changes for a document, so subscribe is a no-op.
const emptySubscribe = () => () => {};
const inAdminIframe = () =>
  typeof window !== 'undefined' && window.parent !== window;

interface UpdateDataMessage {
  type: 'updateData';
  id: string;
  data: Record<string, unknown>;
}
function isUpdateData(d: unknown, formId: string): d is UpdateDataMessage {
  return (
    !!d &&
    typeof d === 'object' &&
    (d as { type?: unknown }).type === 'updateData' &&
    (d as { id?: unknown }).id === formId
  );
}

// Pull THIS doc's body AST out of the overlay payload. The bridge nests it under
// the collection key (`data[collection].body`) but tolerates a flat shape too.
function pickBodyAst(
  data: Record<string, unknown>,
  collection: string,
): unknown {
  const doc = (data?.[collection] ?? data) as Record<string, unknown> | undefined;
  return doc?.body;
}

// Serialize a Tina rich-text body AST back to an MDX string with the Fumadocs
// templates, so Cards/Callout/… round-trip as real MDX JSX. Runs client-side:
// serializeMDX is pure mdast→markdown (no Node APIs) and @tinacms/mdx ships a
// browser build, so it is browser-safe. The security boundary is the strip inside
// the compiler (client-compile.ts), not here.
function bodyAstToMDX(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const field = {
    type: 'rich-text',
    name: 'body',
    templates: fumadocsTemplates,
  } as never;
  const out = serializeMDX(body as never, field, (url: string) => url);
  return typeof out === 'string' ? out : null;
}

/**
 * Inside-the-iframe live renderer. Subscribes to the bridge overlay, debounces,
 * compiles client-side, and renders the REAL components. Split out so the iframe
 * detection wrapper can mount/unmount it cleanly.
 */
function LiveBody({
  formId,
  collection,
  bodyField,
  className,
  getComponents,
  debounceMs,
  onToc,
  children,
}: Required<Omit<TinaLiveBodyProps, 'children' | 'onToc'>> & {
  onToc?: (toc: LiveToc) => void;
  children: React.ReactNode;
}) {
  // The compiled body FC, or null until the first overlay has compiled (we show
  // `children` — the real saved <MDX> — until then, so there's no blank flash).
  const [Body, setBody] = useState<
    React.FC<{ components?: MDXComponents }> | null
  >(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against an out-of-order compile (a slow keystroke resolving after a
  // newer one) clobbering fresher output: only the latest request may commit.
  const latest = useRef(0);

  // Where freshly-compiled tocs go: the explicit `onToc` prop if given, else the
  // nearest <TinaDocsPage> via context (no-op when neither is present). Held in a
  // ref so the message listener always calls the latest without re-subscribing.
  const setLiveToc = useSetLiveToc();
  const pushToc = useRef<(toc: LiveToc) => void>(() => {});
  pushToc.current = onToc ?? setLiveToc;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isUpdateData(event.data, formId)) return;
      const mdx = bodyAstToMDX(pickBodyAst(event.data.data, collection));
      if (mdx == null) return;

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const token = ++latest.current;
        compileFumadocsMDXClient(mdx)
          .then(({ Body: NextBody, toc }) => {
            // Ignore stale resolutions (a newer keystroke already won).
            if (token !== latest.current) return;
            // Wrap in a function so React stores the FC as state (a bare FC would
            // be called as an updater).
            if (NextBody) setBody(() => NextBody);
            // Push the recomputed toc up so the sidebar tracks heading edits.
            pushToc.current(toc as LiveToc);
          })
          .catch((err) => {
            // Surface compile errors in the console; keep the last good render.
            console.error('[tina-live-body] compile failed:', err);
          });
      }, debounceMs);
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [formId, collection, debounceMs]);

  return (
    // NO data-tina-island → the bridge never innerHTML-swaps this node, so React
    // keeps full ownership of the subtree (no removeChild). data-tina-field keeps
    // click-to-edit binding to the body field. data-tina-live tells TinaEditBridge
    // a live body owns this page, so it skips its router.refresh() fallback (which
    // would otherwise revert the title leaf-patch back to saved disk state).
    <div data-tina-field={bodyField} data-tina-live="" className={className}>
      {/* Live-compiled body renders with the PREVIEW-SAFE map so an incomplete
          insert can't crash the whole preview. Until the first compile we still
          show the real saved <MDX> (children), which is production-safe as-is. */}
      {Body ? <Body components={toPreviewComponents(getComponents())} /> : children}
    </div>
  );
}

/**
 * Public component: renders the REAL Fumadocs body everywhere, and additionally
 * makes it keystroke-live inside the admin iframe. Drop into the docs page in
 * place of a bare `<MDX/>`, passing the real `<MDX/>` as children.
 */
export function TinaLiveBody({
  children,
  collection = 'docs',
  debounceMs = 150,
  ...rest
}: TinaLiveBodyProps) {
  const isAdmin = useSyncExternalStore(
    emptySubscribe,
    inAdminIframe, // client snapshot
    () => false, // server snapshot
  );

  if (!isAdmin) return <>{children}</>;
  return (
    // key by formId so navigating between docs REMOUNTS LiveBody — resetting the
    // compiled Body to null so the new doc shows its own real <MDX> (children)
    // until edited, instead of the previous doc's stale compiled body.
    <LiveBody
      key={rest.formId}
      collection={collection}
      debounceMs={debounceMs}
      bodyField={rest.bodyField ?? ''}
      className={rest.className ?? ''}
      formId={rest.formId}
      getComponents={rest.getComponents}
      onToc={rest.onToc}
    >
      {children}
    </LiveBody>
  );
}
