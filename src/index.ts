export { prepareTinaForm } from './server';
export type { TinaQueryResult, PreparedTinaForm } from './server';
export { TinaEditBridge } from './bridge';
// Client-side keystroke-live body that renders the REAL Fumadocs components
// (no placeholder) inside the admin iframe. See live-body.tsx.
export { TinaLiveBody } from './live-body';
export type { TinaLiveBodyProps } from './live-body';
// Preview-only resilience: wraps a real Fumadocs component map in per-component
// error boundaries + Suspense (and guards the known insert-time crashers) so the
// live body preview can't white-screen on a half-filled block. See
// live-error-boundary.tsx. Production renders the unmodified map.
export { toPreviewComponents } from './live-error-boundary';
// Stateful <DocsPage> replacement whose "On this page" toc tracks live heading
// edits in the admin iframe (production renders the same static toc). See
// live-toc.tsx.
export { TinaDocsPage, useSetLiveToc, TocContext } from './live-toc';
export type { LiveToc } from './live-toc';
export { withTinaMarkers } from './markers';
export { fumadocsTemplates } from './templates';
