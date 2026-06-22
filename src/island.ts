// Server-only factory for the @tinacms/bridge "island" endpoint — keystroke-live
// body preview through Fumadocs' OWN compile.
//
// @tinacms/bridge already ships the CLIENT half: init() -> initIslandRefresh()
// POSTs the unsaved overlay to each [data-tina-island] endpoint on every
// debounced edit and swaps the returned HTML in place. This builds the SERVER
// half:
//   * PRIME  (header `X-Tina-Prime: 1`): return the <div data-tina-form> payload
//     so the admin can discover/open the form.
//   * REFRESH (overlay body): overlay -> serializeMDX -> Fumadocs runtime
//     compile -> render -> return the island's new inner markup.

import 'server-only';
import { prepareTinaForm } from './server';
import { compileFumadocsMDX, overlayBodyToMDX, pickOverlayDoc } from './runtime';
import { fumadocsTemplates } from './templates';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface IslandPage {
  /** Path relative to the content dir, e.g. "index.mdx". */
  path: string;
  /** Raw markdown fallback used when the overlay has no body yet. */
  getRawText: () => Promise<string>;
}

export interface TinaIslandRouteOptions {
  /** Map the route slug to the page being previewed (e.g. source.getPage). */
  resolvePage: (
    slug: string[] | undefined,
  ) => IslandPage | null | Promise<IslandPage | null>;
  /** The Fumadocs MDX components map (e.g. getMDXComponents). */
  getComponents: () => Record<string, unknown>;
  /** Run your generated Tina client query for the doc (for the PRIME payload). */
  fetchForm: (
    relativePath: string,
  ) => Promise<{ query: string; variables: object; data: object }>;
  /** rich-text templates for serializeMDX. Default: fumadocsTemplates. */
  templates?: unknown[];
  /** Tina collection name. Default "docs". */
  collection?: string;
  /** Content directory, for baseUrl resolution. Default "content/docs". */
  contentDir?: string;
  /**
   * Authorize a request BEFORE anything is compiled. This route runs the posted
   * overlay through @mdx-js/mdx, which EVALUATES expressions, so an
   * unauthenticated caller could otherwise execute JS / read env on the server.
   * Default: dev-only (`process.env.NODE_ENV !== 'production'`). For cloud /
   * production editing, supply a real check (Next.js draftMode, a preview
   * secret, or admin-iframe origin verification).
   */
  authorize?: (request: Request) => boolean | Promise<boolean>;
}

type RouteCtx = { params: Promise<{ slug?: string[] }> };

const PRIME_HEADER = 'x-tina-prime';

function html(markup: string): Response {
  return new Response(markup, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * Compile + server-render a body MDX string through Fumadocs' runtime pipeline
 * with the preview-safe component map. The single code path behind both the
 * island REFRESH response and the page's SSR seed for <TinaIslandBody>, so the
 * first frame the user sees while editing is byte-for-byte what a subsequent
 * keystroke refresh produces (no markdown/Shiki drift between seed and live).
 */
export async function renderIslandBodyHtml(
  source: string,
  components: unknown,
  baseUrl?: string,
): Promise<string> {
  try {
    const { Body } = await compileFumadocsMDX(source, baseUrl);
    return await renderToHtml(
      Body as (p: { components: unknown }) => unknown,
      components,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `<div data-tina-compile-error style="white-space:pre-wrap;color:#b00">${escapeHtml(
      message,
    )}</div>`;
  }
}

/**
 * Build the SSR seed HTML for <TinaIslandBody> from a page's SAVED content.
 * Call this in the RSC page and hand the result to `<TinaIslandBody initialHtml=…>`.
 * `getComponents` should return the SAME preview-safe map the island route uses
 * (`previewComponents(getMDXComponents())`).
 */
export async function getIslandSeedHtml(opts: {
  getRawText: () => Promise<string>;
  getComponents: () => Record<string, unknown>;
  /** Content directory for baseUrl resolution. Default "content/docs". */
  contentDir?: string;
  /** Page path relative to the content dir, e.g. "index.mdx". */
  path: string;
}): Promise<string> {
  const contentDir = opts.contentDir ?? 'content/docs';
  const raw = (await opts.getRawText()).replace(
    /^---\r?\n[\s\S]*?\r?\n---\r?\n/,
    '',
  );
  const baseUrl = pathToFileURL(join(process.cwd(), contentDir, opts.path)).href;
  return renderIslandBodyHtml(raw, opts.getComponents(), baseUrl);
}
function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Next/Turbopack rejects a static `import 'react-dom/server'` in an App Router
// module; a runtime import in this server-only handler is the supported way.
async function renderToHtml(
  Body: (p: { components: unknown }) => unknown,
  components: unknown,
): Promise<string> {
  const [{ renderToStaticMarkup }, { jsx }] = await Promise.all([
    import('react-dom/server'),
    import('react/jsx-runtime'),
  ]);
  return renderToStaticMarkup(jsx(Body as never, { components } as never) as never);
}

/**
 * Build the POST handler for the keystroke-live island endpoint. Drop into a
 * route file:
 *
 *   export const dynamic = 'force-dynamic';
 *   export const { POST } = createTinaIslandRoute({ resolvePage, getComponents, fetchForm });
 */
export function createTinaIslandRoute(opts: TinaIslandRouteOptions) {
  const collection = opts.collection ?? 'docs';
  const contentDir = opts.contentDir ?? 'content/docs';
  const templates = opts.templates ?? fumadocsTemplates;
  // Safe-by-default: only reachable in development unless the consumer supplies a
  // real authorization check (this route evaluates the posted overlay via MDX).
  const authorize =
    opts.authorize ?? (() => process.env.NODE_ENV !== 'production');

  async function POST(request: Request, ctx: RouteCtx): Promise<Response> {
    // SECURITY GATE: authorize before doing ANY work — this handler compiles the
    // posted overlay through MDX, which evaluates expressions.
    if (!(await authorize(request))) {
      return new Response('Forbidden', { status: 403 });
    }

    const { slug } = await ctx.params;
    const page = await opts.resolvePage(slug);
    if (!page) return new Response('Not found', { status: 404 });

    // PRIME: hand the bridge the form payload so the admin can open the form.
    if (request.headers.get(PRIME_HEADER) === '1') {
      try {
        const res = await opts.fetchForm(page.path);
        const tina = prepareTinaForm(res);
        return html(
          `<div data-tina-form="${escapeAttr(
            JSON.stringify(tina.payload),
          )}" data-tina-primary="" style="display:none"></div>`,
        );
      } catch {
        return html('<div></div>');
      }
    }

    // REFRESH: overlay -> MDX -> Fumadocs compile -> HTML.
    let overlay: Record<string, unknown> = {};
    try {
      overlay = (await request.json()) as Record<string, unknown>;
    } catch {
      overlay = {};
    }

    const doc = pickOverlayDoc(overlay, collection);
    const mdx = doc ? overlayBodyToMDX(doc.body, templates) : null;
    // Fall back to on-disk content for the first frame (before the admin posts),
    // stripping frontmatter so it doesn't render as an <hr> + stray heading.
    const source =
      mdx ?? (await page.getRawText()).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    const baseUrl = pathToFileURL(join(process.cwd(), contentDir, page.path)).href;

    const bodyHtml = await renderIslandBodyHtml(
      source,
      opts.getComponents(),
      baseUrl,
    );

    // The bridge copies data-tina-* attrs off the returned wrapper, so re-emit
    // the body field marker or click-to-edit is lost after the first swap.
    const formId = Object.keys(overlay)[0];
    const field = formId
      ? ` data-tina-field="${escapeAttr(`${formId}---${collection}.body`)}"`
      : '';
    return html(`<div data-tina-island-body${field}>${bodyHtml}</div>`);
  }

  return { POST };
}

/** Build the island endpoint URL for a slug (must match your route file path). */
export function tinaIslandUrl(
  slug: string[] | undefined,
  basePath = '/api/tina-island/docs',
): string {
  return slug && slug.length ? `${basePath}/${slug.join('/')}` : basePath;
}
