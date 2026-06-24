'use client';

// Client mount for @tinacms/bridge on a server-rendered (RSC) framework page
// such as Fumadocs. The framework keeps rendering the body; this only wires the
// admin <-> page edit channel.
//
//   - init() connects to the admin iframe (no-op outside it, safe in prod).
//   - On each unsaved edit (admin posts `updateData`):
//       (1) leaf string fields marked data-tina-leaf are patched in the DOM for
//           instant per-keystroke feedback (e.g. the page title),
//       (2) the body round-trips via debounced router.refresh() through the
//           framework's own render — see below for why this is only a fallback.
//
// Keystroke-live body preview is provided by <TinaLiveBody> (live-body.tsx),
// which runs its OWN `updateData` listener and recompiles the body CLIENT-side
// on every edit (rendering the REAL Fumadocs components, no placeholder). That
// path is independent of this component. The debounced router.refresh() here
// stays as a fallback so a page WITHOUT <TinaLiveBody> still reflects structural
// edits on save; when <TinaLiveBody> is present the live render already shows the
// unsaved body, and router.refresh() merely reconciles to saved disk state.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { init, refreshForms } from '@tinacms/bridge';

interface UpdateDataMessage {
  type: 'updateData';
  id: string;
  data: Record<string, unknown>;
}

function isUpdateData(d: unknown): d is UpdateDataMessage {
  return (
    !!d &&
    typeof d === 'object' &&
    (d as { type?: unknown }).type === 'updateData' &&
    typeof (d as { id?: unknown }).id === 'string'
  );
}

export function TinaEditBridge({
  formId,
  collection = 'docs',
  refreshDebounceMs = 600,
}: {
  formId: string;
  /** Tina collection name; used to address marked leaf fields. */
  collection?: string;
  refreshDebounceMs?: number;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connect the bridge once. init() wires the admin<->page channel (and the
  // bridge's own island-refresh). No-op outside the /admin iframe, safe in prod.
  useEffect(() => {
    init();
  }, []);

  // Re-scan this page's [data-tina-form] payload whenever the doc changes, so a
  // soft navigation between docs rebinds the editor to the new doc without a
  // manual refresh. (refreshForms no-ops until init() has finished.)
  useEffect(() => {
    refreshForms();
    if (typeof window === 'undefined' || window.parent === window) return;

    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!isUpdateData(msg) || msg.id !== formId) return;

      // (1) Instant in-place patch of leaf string fields (e.g. the title).
      // Field markers look like `<id>---<collection>.<field>`.
      const node = ((msg.data as Record<string, unknown>)?.[collection] ??
        msg.data) as Record<string, unknown> | undefined;
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (typeof value !== 'string') continue;
          const el = document.querySelector(
            `[data-tina-field="${formId}---${collection}.${key}"]`,
          );
          if (el && el.getAttribute('data-tina-leaf') === 'true') {
            el.textContent = value;
          }
        }
      }

      // (2) Round-trip body/structural edits through the framework's render.
      // The no-live-body fallback (see header). When <TinaLiveBody> is on the page
      // it sets [data-tina-live] and already renders the unsaved body client-side,
      // AND the leaf patch above handles string fields — so a router.refresh() here
      // would only re-render the server tree from SAVED disk state, reverting the
      // live title leaf-patch. Skip it; the live body is the source of truth.
      if (
        typeof document !== 'undefined' &&
        document.querySelector('[data-tina-live]')
      ) {
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        router.refresh();
      }, refreshDebounceMs);
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [formId, collection, router, refreshDebounceMs]);

  return null;
}
