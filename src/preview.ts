// Component map for the island's SERVER render (renderToStaticMarkup), which
// CANNOT invoke Fumadocs' `'use client'` components (Heading, Link; Card renders
// Link internally, so it breaks too). Scope of the live preview is deliberate:
//
//   GENERAL MARKDOWN  → plain HTML tags. They render INSIDE Fumadocs' `.prose`
//   container (DocsBody adds `prose flex-1`), so headings, lists, links,
//   bold/italic, inline code, blockquotes, tables and hr inherit Fumadocs' real
//   prose CSS, and fenced code keeps REAL Shiki (highlighting is baked at COMPILE
//   time by rehypeCode, before this map is ever consulted). → HIGH fidelity.
//
//   FUMADOCS UI COMPONENTS (Card, Cards, Callout, Tabs, Steps, Accordions, Files)
//   → an HONEST, visually-distinct "renders on your site" PLACEHOLDER: a muted
//   bordered box that NAMES the component. We do NOT fake their chrome with plain
//   boxes (that lies about fidelity); the placeholder makes clear the real
//   component appears on save, when the page re-renders through Fumadocs proper.
//
// Everything snaps to the real Fumadocs render the moment the doc is saved.

import { createElement, type CSSProperties, type ReactNode } from 'react';
import type { MDXComponents } from 'mdx/types';

type Props = Record<string, unknown> & {
  children?: ReactNode;
  title?: unknown;
  href?: unknown;
};

// Map a markdown element to a PLAIN tag (never a Fumadocs client component),
// forwarding props so compiled attributes (heading ids, code data-*, etc.)
// survive. Styling comes from the surrounding `.prose`.
const tag =
  (name: string) =>
  ({ children, ...rest }: Props) =>
    createElement(name, rest, children);

// Fenced code. The published page renders Fumadocs' CLIENT <CodeBlock>: a
// full-width `bg-fd-card` figure frame (border, radius, shadow) wrapping a
// transparent <pre>, plus a copy button. The server preview can't run that
// client component, so the bare Shiki <pre> alone looked like a narrow box. We
// rebuild the SAME figure frame here so the preview matches the site; the <pre>
// keeps its `.shiki` classes (syntax colors) but goes transparent so the card
// shows through. `icon` (the language-icon SVG the client CodeBlock consumes) is
// dropped, else it leaks as a raw attribute. Only the copy button is missing,
// because it's a client-only interaction.
const codePre = ({ children, icon: _icon, style, ...rest }: Props) =>
  createElement(
    'figure',
    {
      'data-tina-preview-codeblock': '',
      className: 'not-prose my-4 overflow-x-auto rounded-xl border bg-fd-card text-sm shadow-sm',
    },
    createElement(
      'pre',
      {
        ...rest,
        style: { ...(style as CSSProperties), margin: 0, padding: '0.75rem 1rem', background: 'transparent' },
      },
      children,
    ),
  );

// ── honest "renders on your site" placeholder for Fumadocs UI components ──────────
// React wants `style` as an object, not a CSS string — author them as objects.

const PLACEHOLDER_STYLE: CSSProperties = {
  display: 'block',
  margin: '1rem 0',
  border: '1px dashed var(--color-fd-border, #d4d4d8)',
  borderRadius: '8px',
  background: 'var(--color-fd-muted, #f4f4f5)',
  color: 'var(--color-fd-muted-foreground, #71717a)',
  padding: 0,
  overflow: 'hidden',
  fontSize: '.875rem',
};
const PLACEHOLDER_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '.5rem',
  padding: '.5rem .75rem',
  borderBottom: '1px dashed var(--color-fd-border, #d4d4d8)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '.75rem',
  letterSpacing: '.02em',
};
const PLACEHOLDER_TAG_STYLE: CSSProperties = {
  fontWeight: 600,
  color: 'var(--color-fd-foreground, #18181b)',
};
const PLACEHOLDER_NOTE_STYLE: CSSProperties = { opacity: 0.8 };
const PLACEHOLDER_BODY_STYLE: CSSProperties = { padding: '.5rem .75rem' };

/**
 * An honest placeholder for a Fumadocs UI component. A muted dashed box whose
 * header names the component (`<Card>`) and states it renders on your site; any inner
 * markdown content is shown beneath (muted) so the editor still sees what they
 * are typing, clearly demarcated from the real render.
 */
const placeholder =
  (name: string) =>
  ({ children, title }: Props) =>
    createElement(
      'div',
      {
        'data-tina-preview-placeholder': name,
        // not-prose: keep prose CSS from restyling the placeholder chrome.
        className: 'not-prose',
        style: PLACEHOLDER_STYLE,
      },
      createElement(
        'div',
        { key: 'bar', style: PLACEHOLDER_BAR_STYLE },
        createElement('span', { key: 'tag', style: PLACEHOLDER_TAG_STYLE }, `<${name}>`),
        createElement('span', { key: 'note', style: PLACEHOLDER_NOTE_STYLE }, 'renders on your site'),
      ),
      title != null && String(title).length
        ? createElement(
            'div',
            { key: 'title', style: { ...PLACEHOLDER_BODY_STYLE, fontWeight: 600 } },
            String(title),
          )
        : null,
      children != null
        ? createElement('div', { key: 'body', style: PLACEHOLDER_BODY_STYLE }, children)
        : null,
    );

/**
 * Wrap a Fumadocs MDX components map with preview-safe stand-ins for the island
 * endpoint. Pass `getMDXComponents()` (plus any custom components) through it.
 *
 * Markdown elements → plain tags (real prose CSS + real Shiki). Fumadocs UI
 * components → honest "renders on your site" placeholders.
 */
export function previewComponents(base: MDXComponents): MDXComponents {
  return {
    ...base,

    // ── GENERAL MARKDOWN → plain tags (faithful via .prose + compiled Shiki) ──
    a: tag('a'),
    p: tag('p'),
    h1: tag('h1'),
    h2: tag('h2'),
    h3: tag('h3'),
    h4: tag('h4'),
    h5: tag('h5'),
    h6: tag('h6'),
    ul: tag('ul'),
    ol: tag('ol'),
    li: tag('li'),
    blockquote: tag('blockquote'),
    strong: tag('strong'),
    em: tag('em'),
    del: tag('del'),
    code: tag('code'), // inline code; fenced code is <pre><code> w/ baked Shiki
    pre: codePre, // fenced code; strips the leaked `icon` SVG attr
    hr: tag('hr'),
    img: tag('img'),
    table: tag('table'),
    thead: tag('thead'),
    tbody: tag('tbody'),
    tr: tag('tr'),
    th: tag('th'),
    td: tag('td'),

    // ── FUMADOCS UI COMPONENTS → honest "renders on your site" placeholders ───────
    Card: placeholder('Card'),
    Cards: placeholder('Cards'),
    Callout: placeholder('Callout'),
    Tabs: placeholder('Tabs'),
    Tab: placeholder('Tab'),
    Accordions: placeholder('Accordions'),
    Accordion: placeholder('Accordion'),
    Steps: placeholder('Steps'),
    Step: placeholder('Step'),
    Files: placeholder('Files'),
    File: placeholder('File'),
    Folder: placeholder('Folder'),
  } as unknown as MDXComponents;
}
