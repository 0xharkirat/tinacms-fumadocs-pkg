// Server-only runtime MDX compile + overlay helpers — the core of keystroke-live
// body preview. Takes an arbitrary MDX string (serialized from the editor's
// UNSAVED overlay) and runs it through Fumadocs' OWN compile pipeline at request
// time (Shiki, heading anchors, toc, structuredData). NOT TinaMarkdown.
//
// Verified path (fumadocs v16 + @mdx-js/mdx):
//   fumadocs-core/content/mdx/preset-runtime -> mdxPreset() gives Fumadocs'
//   runtime ProcessorOptions; @mdx-js/mdx compile()+run() evaluates it into a
//   body component. Mirrors fumadocs-mdx/runtime/dynamic, but fed a string
//   instead of a file on disk.

import 'server-only';
import { compile, run } from '@mdx-js/mdx';
import * as jsxRuntime from 'react/jsx-runtime';
import { serializeMDX } from '@tinacms/mdx';
import type { ReactNode } from 'react';
import type { MDXProps } from 'mdx/types';
import type { ProcessorOptions } from '@mdx-js/mdx';

export interface CompiledMDX {
  Body: (props: MDXProps) => ReactNode;
  toc: unknown[];
  structuredData?: unknown;
}

// Resolve Fumadocs' runtime processor options once (Shiki highlighter caches
// inside rehypeCode). Lazy import keeps it off the build-time bundler graph.
let optionsPromise: Promise<ProcessorOptions> | null = null;
async function getOptions(): Promise<ProcessorOptions> {
  if (!optionsPromise) {
    const { mdxPreset } = await import('fumadocs-core/content/mdx/preset-runtime');
    // Pass the same mdxOptions you'd use in source.config.ts (e.g.
    // remarkAutoTypeTable from fumadocs-typescript) to match production exactly.
    optionsPromise = mdxPreset({});
  }
  return optionsPromise;
}

/** Compile an arbitrary MDX string through Fumadocs' runtime pipeline. */
export async function compileFumadocsMDX(
  source: string,
  baseUrl?: string,
): Promise<CompiledMDX> {
  const options = await getOptions();
  const file = await compile(source, {
    ...options,
    // SECURITY: neutralise MDX expressions/ESM at COMPILE time. The island
    // compiles the editor's UNTRUSTED overlay, and @mdx-js/mdx evaluates `{…}`
    // and import/export as server JS — so attacker text like `{process.env.X}`
    // (in body text OR a JSX prop) would leak env / run code. This plugin runs
    // after remark-mdx has parsed the source, so it strips every expression no
    // matter how it entered the string (input-AST checks miss text + props).
    // `{…}` is never legitimate docs-body content, so removal is safe; and only
    // this PREVIEW compile is affected — production still uses Fumadocs' own
    // renderer.
    remarkPlugins: [
      ...(options.remarkPlugins ?? []),
      remarkStripMdxExpressions,
    ] as ProcessorOptions['remarkPlugins'],
    development: false,
    outputFormat: 'function-body',
  });
  const mod = (await run(String(file), { ...jsxRuntime, baseUrl })) as {
    default: (props: MDXProps) => ReactNode;
    toc?: unknown[];
    structuredData?: unknown;
  };
  return { Body: mod.default, toc: mod.toc ?? [], structuredData: mod.structuredData };
}

export interface OverlayDoc {
  title?: string;
  body?: unknown; // Tina rich-text AST
}

/**
 * Pull this page's doc out of the bridge overlay payload (`{ [formId]: data }`),
 * accepting both the GraphQL shape `{ <collection>: {...} }` and a flat `{...}`.
 */
export function pickOverlayDoc(
  overlay: Record<string, unknown>,
  collection = 'docs',
  formId?: string,
): OverlayDoc | null {
  const entries = Object.entries(overlay);
  if (entries.length === 0) return null;
  const chosen =
    (formId && overlay[formId]) ??
    entries.map(([, v]) => v).find((v) => !!v && typeof v === 'object');
  if (!chosen || typeof chosen !== 'object') return null;
  const node = chosen as Record<string, unknown>;
  const doc = (node[collection] ?? node) as Record<string, unknown>;
  if (!doc || typeof doc !== 'object') return null;
  return {
    title: typeof doc.title === 'string' ? doc.title : undefined,
    body: doc.body,
  };
}

/**
 * Serialize the overlay body (Tina rich-text AST) back to an MDX string with the
 * given rich-text `templates` (so Cards/Callout/… round-trip as real MDX JSX).
 */
export function overlayBodyToMDX(
  body: unknown,
  templates: unknown[],
  fieldName = 'body',
): string | null {
  if (!body || typeof body !== 'object') return null;
  const field = { type: 'rich-text', name: fieldName, templates } as never;
  const out = serializeMDX(body as never, field, (url: string) => url);
  // The actual security boundary is the compile-time strip in
  // compileFumadocsMDX (remarkStripMdxExpressions) — it removes evaluated MDX
  // from the parsed tree, covering body text AND JSX props, which an input-AST
  // check here could not.
  return typeof out === 'string' ? out : null;
}

// --- SECURITY: strip evaluated MDX from the UNTRUSTED preview compile ---------
// Node types @mdx-js/mdx turns into evaluated server-side JS. We remove them
// from the PARSED mdast (not the input overlay), so every entry path is covered.
const UNSAFE_MDX_NODES = new Set([
  'mdxFlowExpression', // {expr} as a block
  'mdxTextExpression', // {expr} inline inside text
  'mdxjsEsm', // import / export
]);

/**
 * remark plugin: remove MDX expression / ESM nodes and expression-valued JSX
 * attributes (`<Tabs items={…}/>`, `{...spread}`) anywhere in the tree.
 */
function remarkStripMdxExpressions() {
  return (tree: unknown) => {
    stripMdxExpressions(tree);
  };
}
function stripMdxExpressions(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { children?: unknown[]; attributes?: unknown[] };
  if (Array.isArray(n.children)) {
    n.children = n.children.filter(
      (c) =>
        !(
          c &&
          typeof c === 'object' &&
          UNSAFE_MDX_NODES.has((c as { type?: string }).type ?? '')
        ),
    );
    n.children.forEach(stripMdxExpressions);
  }
  // JSX element props evaluate too — drop expression / spread attributes.
  if (Array.isArray(n.attributes)) {
    n.attributes = n.attributes.filter((a) => {
      if (!a || typeof a !== 'object') return true;
      const at = a as { type?: string; value?: { type?: string } | null };
      return (
        at.type !== 'mdxJsxExpressionAttribute' &&
        at.value?.type !== 'mdxJsxAttributeValueExpression'
      );
    });
  }
}
