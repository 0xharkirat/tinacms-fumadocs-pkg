// CLIENT-side MDX compile engine for the keystroke-live body preview. It runs IN
// THE BROWSER so it can produce React elements that mount the REAL Fumadocs
// `'use client'` components (Card, Tabs, …): React owns the subtree, so
// `<Card href>` renders its real `rounded-xl border bg-fd-card` chrome with no
// "Link is on the client" error. (A server-side render of the body could only
// emit placeholders for those client components — which is why the live preview
// is deliberately client-side. See live-body.tsx.)
//
// NO 'server-only' — this is the client half by design.
//
// ── Why NOT `createCompiler` from '@fumadocs/mdx-remote' (the Turbopack wall) ──
// The obvious one-liner is `createCompiler({ remarkImageOptions:false, … })`. It
// works at runtime, but its main entry STATICALLY does `import * as Plugins from
// 'fumadocs-core/mdx-plugins'` — a barrel that re-exports `remark-image`, which
// imports `node:fs`/`node:path` at module top level. Turbopack bundles the whole
// static graph for the CLIENT regardless of `remarkImageOptions:false` (that flag
// only skips the plugin at RUN time), and its client chunking context rejects
// `node:fs`:  "the chunking context does not support external modules (request:
// node:fs)" → the page 500s. So we cannot import the all-in-one compiler into a
// 'use client' module.
//
// ── The fix: split COMPILE from RENDER, each via a node:fs-free path ───────────
//   COMPILE (string → compiled JS string): @mdx-js/mdx's `compile()` is pure and
//     client-safe. We wire Fumadocs' OWN plugins onto it — but imported via their
//     individual DEEP subpaths (`fumadocs-core/mdx-plugins/rehype-code`, …), NOT
//     the barrel, and deliberately WITHOUT remark-image — so no `node:fs` ever
//     enters the client graph. This reproduces production's pipeline for the body
//     (GFM, heading anchors, real Shiki via rehypeCode `engine:"js"`, toc).
//   RENDER (compiled string → MdxContent FC): `@fumadocs/mdx-remote/client`'s
//     `executeMdx` — the client render half, which imports only
//     `react/jsx-runtime`. This is the "via @fumadocs/mdx-remote" engine; it
//     `new Function`-evaluates the compiled body into the FC we render.

import { compile } from '@mdx-js/mdx';
import type { ProcessorOptions } from '@mdx-js/mdx';
// Fumadocs plugins via DEEP subpaths (NOT the `mdx-plugins` barrel) so the client
// graph never pulls remark-image → node:fs. Matches production's body pipeline.
import { remarkGfm } from 'fumadocs-core/mdx-plugins/remark-gfm';
import { remarkHeading } from 'fumadocs-core/mdx-plugins/remark-heading';
import { rehypeCode, rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins/rehype-code';
import { rehypeToc } from 'fumadocs-core/mdx-plugins/rehype-toc';
// The CLIENT render engine from @fumadocs/mdx-remote (node:fs-free; only needs
// react/jsx-runtime). Evaluates the compiled function-body into the MdxContent FC.
import { executeMdx } from '@fumadocs/mdx-remote/client';
import { remarkStripMdxExpressions } from './strip-mdx';
import type { MDXComponents } from 'mdx/types';
import type { FC } from 'react';

/** The compiled body: a Fumadocs MdxContent FC + its table of contents. */
export interface CompiledMDXClient {
  /** Render as `<Body components={getComponents()} />`. */
  Body: FC<{ components?: MDXComponents }>;
  toc: unknown[];
}

// Build the @mdx-js/mdx ProcessorOptions ONCE (module scope). We mirror what
// @fumadocs/mdx-remote's `getCompileOptions` produces, MINUS remark-image:
//   remarkGfm            — tables / strikethrough / task lists
//   remarkHeading        — heading ids + anchors (and feeds the toc)
//   remarkStripMdxExpr.  — SECURITY: neutralise `{…}` / import-export in the
//                          untrusted overlay (see strip-mdx.ts)
//   rehypeCode (js)      — REAL Shiki highlighting, baked at compile time
//   rehypeToc            — emit the `toc` export
// outputFormat 'function-body' + development:false → production `_jsx` calls that
// `executeMdx` (which defaults to react/jsx-runtime) can evaluate.
const PROCESSOR_OPTIONS: ProcessorOptions = {
  outputFormat: 'function-body',
  development: false,
  remarkPlugins: [
    remarkGfm,
    remarkHeading,
    // Strip runs LAST so it sees the fully-parsed mdast (text, inline, JSX props).
    remarkStripMdxExpressions,
  ],
  rehypePlugins: [
    [rehypeCode, rehypeCodeDefaultOptions],
    rehypeToc,
  ],
} as ProcessorOptions;

/**
 * Compile an MDX string (serialized from the editor's unsaved overlay) into a
 * renderable Fumadocs body, entirely client-side.
 *
 * @returns `{ Body, toc }`. `Body` is the MdxContent FC — render it once with the
 *   REAL Fumadocs component map: `<Body components={getMDXComponents()} />`.
 */
export async function compileFumadocsMDXClient(
  source: string,
): Promise<CompiledMDXClient> {
  // 1) string → compiled function-body string (Fumadocs pipeline, client-safe).
  const file = await compile(source, PROCESSOR_OPTIONS);
  // 2) compiled string → evaluated module via @fumadocs/mdx-remote's client
  //    engine. `default` is the MdxContent FC; `toc` is the heading tree.
  const mod = (await executeMdx(String(file))) as {
    default: FC<{ components?: MDXComponents }>;
    toc?: unknown[];
  };
  return { Body: mod.default, toc: mod.toc ?? [] };
}
