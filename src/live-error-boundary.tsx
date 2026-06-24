'use client';

// PREVIEW-ONLY resilience for the keystroke-live body (live-body.tsx).
//
// The live preview renders the body CLIENT-side via @fumadocs/mdx-remote, with
// React owning the whole subtree. The catch: the editor inserts a component
// BEFORE its props are filled, so a freshly-inserted block renders with empty /
// missing props for a beat. Several real Fumadocs components throw in that state,
// and because the preview is one client React tree with NO error boundary, a
// single throw white-screens the entire preview until reload.
//
// This module makes the preview self-heal. It exports `toPreviewComponents`,
// which takes the REAL Fumadocs map and returns a preview-safe one:
//   • three known crashers get bespoke guards (img / GithubInfo / InlineTOC),
//   • EVERY entry is then wrapped in an <ErrorBoundary> + <Suspense> so any other
//     component that throws (sync) or suspends (async) on insert degrades to a
//     small placeholder and RECOVERS the instant the editor fills the field.
//
// PRODUCTION IS UNTOUCHED: nothing here runs on the server <MDX> render. Only the
// in-iframe live path (live-body.tsx) calls `toPreviewComponents`. The real
// `components.ts` map stays exactly as shipped.
//
// Style note: this is a .tsx module, so we use JSX directly (unlike the .ts
// `components.ts`, which can't). The ErrorBoundary must be a class component —
// React only supports error catching via class lifecycle (no hook equivalent).

import * as React from 'react';
import type { ComponentProps, ComponentType, ReactNode } from 'react';
import type { MDXComponents } from 'mdx/types';

// ── img: plain <img>, never next/image ───────────────────────────────────────
// Markdown images resolve to Fumadocs' `Image` = next/image, which REQUIRES
// width/height. The live compile omits remark-image (see client-compile.ts), so
// preview images carry no dimensions → next/image throws "Image is missing
// required width property". We never want to reach next/image in the preview, so
// override `img` with a plain lazy <img>. (Production still gets next/image.)
function PreviewImg(props: ComponentProps<'img'>) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img loading="lazy" {...props} />;
}

// ── GithubInfo: guard empty owner/repo ───────────────────────────────────────
// A freshly-inserted <GithubInfo> has empty owner/repo. The real component fires
// a GitHub API call that 404s, and because it reads the result via React `use()`,
// the rejected promise gets cached and RE-THROWS on every render → a wall of
// "Encountered two children with the same key, ''" errors. Until BOTH owner and
// repo are non-empty we render a muted placeholder instead and never mount the
// real component, so no doomed fetch is ever started.
function SafeGithubInfo({
  owner,
  repo,
  ...rest
}: { owner?: string; repo?: string } & Record<string, unknown>) {
  const Real = realRef.GithubInfo as ComponentType<Record<string, unknown>> | undefined;
  if (!owner || !repo || !Real) {
    return <PreviewPlaceholder>GithubInfo: set owner and repo</PreviewPlaceholder>;
  }
  return <Real owner={owner} repo={repo} {...rest} />;
}

// ── InlineTOC: default items to [] ────────────────────────────────────────────
// An empty insert gives `items === undefined`; the real component does
// `items.map(...)` and throws. Defaulting to `[]` renders the empty collapsible
// cleanly, and it fills in live as the editor adds rows.
function SafeInlineTOC({
  items,
  ...rest
}: { items?: unknown[] } & Record<string, unknown>) {
  const Real = realRef.InlineTOC as ComponentType<Record<string, unknown>> | undefined;
  if (!Real) return <PreviewPlaceholder>InlineTOC</PreviewPlaceholder>;
  return <Real items={items ?? []} {...rest} />;
}

// Holds the REAL overridden components so the Safe* wrappers above can reach the
// genuine implementation without it being re-wrapped (the override map replaces
// these keys, so a Safe* wrapper can't look itself up in the final map). Set per
// call by `toPreviewComponents`. A module-level ref is fine: the preview renders
// one body at a time from a single real map.
const realRef: { GithubInfo?: unknown; InlineTOC?: unknown } = {};

// ── shared placeholder ────────────────────────────────────────────────────────
// Small, muted, non-throwing stand-in shown while a block is incomplete.
function PreviewPlaceholder({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.5rem',
        borderRadius: '0.375rem',
        fontSize: '0.85em',
        color: 'var(--color-fd-muted-foreground, #888)',
        border: '1px dashed var(--color-fd-border, #8884)',
      }}
    >
      {children}
    </span>
  );
}

// ── ErrorBoundary ─────────────────────────────────────────────────────────────
// Catches SYNCHRONOUS throws from one wrapped component, renders a placeholder,
// and AUTO-RESETS when its children change so it recovers the moment the editor
// fills the offending field. We re-key the boundary on `children` identity:
// every live recompile produces fresh element children, so a changed prop yields
// a new boundary instance with clean state — no manual reset wiring needed.
//
// NOTE: an error boundary catches throws only. GithubInfo throws a PROMISE (via
// React `use()`), which is a SUSPENSE signal, not an error — so the boundary is
// paired with <Suspense> in `toPreviewComponents` to absorb that case too.
interface BoundaryProps {
  /** Name shown in the placeholder, e.g. "Callout". */
  name: string;
  children: ReactNode;
}
interface BoundaryState {
  failed: boolean;
}
class ErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <PreviewPlaceholder>
          {'⚠ '}
          {this.props.name}: finish filling its fields
        </PreviewPlaceholder>
      );
    }
    return this.props.children;
  }
}

/**
 * Turn the REAL Fumadocs component map into a PREVIEW-SAFE one for the live body.
 *
 * 1. Override the three known crashers with their guarded versions
 *    (img → plain lazy <img>, GithubInfo → empty-prop guard, InlineTOC → `items
 *    ?? []`).
 * 2. Wrap EVERY entry (overrides included) so that, per component instance:
 *      <ErrorBoundary><Suspense fallback>…</Suspense></ErrorBoundary>
 *    Suspense (inner) absorbs async-suspend / thrown promises (GithubInfo's
 *    `use()`); the ErrorBoundary (outer) absorbs synchronous throws. Both reset
 *    on the next recompile because the wrapper renders fresh children, so the
 *    preview recovers as soon as the field is filled. The boundary re-keys on
 *    children identity (see ErrorBoundary) for that recovery.
 *
 * Only the LIVE preview uses this. Production renders the unmodified `real` map.
 */
export function toPreviewComponents(real: MDXComponents): MDXComponents {
  // Expose the genuine implementations to the Safe* wrappers (which intentionally
  // bypass the wrapped map for the real component).
  realRef.GithubInfo = real.GithubInfo;
  realRef.InlineTOC = real.InlineTOC;

  // Start from the real map, then swap the three crashers for safe versions.
  const overridden: MDXComponents = {
    ...real,
    img: PreviewImg,
    GithubInfo: SafeGithubInfo,
    InlineTOC: SafeInlineTOC,
  };

  // Wrap every entry in <ErrorBoundary> + <Suspense>. Keyed by component name so
  // the placeholder can name the culprit, and a fresh wrapper FC per key keeps
  // the wrapping stable across renders of the same key.
  const safe: MDXComponents = {};
  for (const [name, Component] of Object.entries(overridden)) {
    const Wrapped = (props: Record<string, unknown>) => (
      <ErrorBoundary name={name}>
        <React.Suspense fallback={<PreviewPlaceholder>{name}…</PreviewPlaceholder>}>
          {React.createElement(Component as ComponentType, props)}
        </React.Suspense>
      </ErrorBoundary>
    );
    Wrapped.displayName = `Preview(${name})`;
    safe[name] = Wrapped as MDXComponents[string];
  }
  return safe;
}
