import { source } from '@/lib/source';
import { getMDXComponents } from '@/components/mdx';
import { client } from '@/tina/__generated__/client';
import { createTinaIslandRoute } from 'tinacms-fumadocs-pkg/island';
import { previewComponents } from 'tinacms-fumadocs-pkg/preview';

// Request-time: serializes the editor's unsaved overlay to MDX and compiles it
// through Fumadocs' own pipeline (Shiki, anchors, toc). Never static.
export const dynamic = 'force-dynamic';

export const { POST } = createTinaIslandRoute({
  resolvePage: (slug) => {
    const page = source.getPage(slug);
    if (!page) return null;
    return { path: page.path, getRawText: () => page.data.getText('raw') };
  },
  // Server-render of the body can't invoke Fumadocs' client components, so swap
  // them for preview-safe stand-ins (markdown + Shiki stay real).
  getComponents: () => previewComponents(getMDXComponents()),
  fetchForm: (relativePath) =>
    client.queries.docs(
      { relativePath },
      { fetchOptions: { cache: 'no-store' } },
    ),
});
