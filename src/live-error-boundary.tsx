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
//   • known crashers get bespoke guards (img / GithubInfo / InlineTOC / Tab),
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

// ── Tab: guard missing value ──────────────────────────────────────────────────
// A freshly-inserted <Tab> (added before the editor sets a label) has no
// resolvable `value`, and the real component throws "Failed to resolve tab
// value". The ErrorBoundary catches it, but the throw still surfaces a Next.js
// dev error overlay over the preview. We pass a fallback value so the real Tab
// never throws; it updates live the moment the editor fills in a label.
function SafeTab({ ...props }: Record<string, unknown>) {
  const Real = realRef.Tab as ComponentType<Record<string, unknown>> | undefined;
  if (!Real) return <PreviewPlaceholder>Tab</PreviewPlaceholder>;
  const value = props.value ?? props.title ?? props.label ?? 'tab';
  return <Real {...props} value={value} />;
}

// Holds the REAL overridden components so the Safe* wrappers above can reach the
// genuine implementation without it being re-wrapped (the override map replaces
// these keys, so a Safe* wrapper can't look itself up in the final map). Set per
// call by `toPreviewComponents`. A module-level ref is fine: the preview renders
// one body at a time from a single real map.
const realRef: { GithubInfo?: unknown; InlineTOC?: unknown; Tab?: unknown } = {};

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
// Catches SYNCHRONOUS throws from one wrapped component and renders a
// placeholder. There is intentionally NO `key` here and no manual reset wiring:
// recovery happens because each live recompile produces a brand-new `Body`
// component TYPE (see live-body.tsx), so React unmounts the entire previous
// subtree — failed boundaries included — and mounts fresh ones with clean state.
// The boundary therefore self-heals the moment the editor fills the offending
// field and the next recompile lands.
//
// CAVEAT: a boundary does NOT reset on a same-type re-render with new props —
// once `failed` is set it stays set until unmount. That is fine here precisely
// because every recompile is a new component type (a full unmount), never an
// in-place prop change, so the boundary never needs to clear in place.
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
 * 1. Override the known crashers with their guarded versions
 *    (img → plain lazy <img>, GithubInfo → empty-prop guard, InlineTOC → `items
 *    ?? []`, Tab → fallback `value`).
 * 2. Wrap EVERY entry (overrides included) so that, per component instance:
 *      <ErrorBoundary><Suspense fallback>…</Suspense></ErrorBoundary>
 *    Suspense (inner) absorbs async-suspend / thrown promises (GithubInfo's
 *    `use()`); the ErrorBoundary (outer) absorbs synchronous throws. Both reset
 *    on the next recompile because each recompile yields a brand-new `Body`
 *    component TYPE, so React unmounts the whole previous subtree (failed
 *    boundaries included) and remounts fresh — see ErrorBoundary. The preview
 *    thus recovers as soon as the field is filled.
 *
 * Only the LIVE preview uses this. Production renders the unmodified `real` map.
 */
export function toPreviewComponents(real: MDXComponents): MDXComponents {
  // Expose the genuine implementations to the Safe* wrappers (which intentionally
  // bypass the wrapped map for the real component). MUST run before the override
  // map below replaces these keys, or the wrappers would capture themselves.
  realRef.GithubInfo = real.GithubInfo;
  realRef.InlineTOC = real.InlineTOC;
  realRef.Tab = real.Tab;

  // Start from the real map, then swap the known crashers for safe versions.
  const overridden: MDXComponents = {
    ...real,
    img: PreviewImg,
    GithubInfo: SafeGithubInfo,
    InlineTOC: SafeInlineTOC,
    Tab: SafeTab,
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
