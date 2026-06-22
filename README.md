# tinacms-fumadocs-pkg

Add **TinaCMS** visual editing to a **Fumadocs** (Next.js App Router) site **without reimplementing Fumadocs' renderer**. The `.mdx` file on disk is the only contract: TinaCMS edits it, Fumadocs compiles it.

**What you get:** the docs body updates **per keystroke** in the editor. Markdown (headings, bold/italic, links, lists, tables, images, and **code blocks with real Shiki**) is compiled live through Fumadocs' own runtime MDX. Production is untouched (the editing layer only runs inside the admin iframe).

**What you don't (yet):** Fumadocs' `'use client'` UI components (`Card`, `Callout`, `Tabs`, `Steps`, `Accordions`, `Files`, …) can't be invoked by the server-side preview compile, so they show an honest, labelled placeholder in the editor and render for real on your published page. (Fully-live UI components need a non-RSC Fumadocs template; see *Limitations*.)

## Quick start

In an existing Fumadocs site that has already run `npx @tinacms/cli init`:

```bash
pnpm dlx github:0xharkirat/tinacms-fumadocs-pkg init
```

> Use `pnpm dlx`, not `npx`. npm's strict peer resolution rejects the fetch (`fumadocs-core` wants `react-router` 7, `tinacms` brings 6); pnpm is lenient. On an npm project: `npm_config_legacy_peer_deps=true npx github:0xharkirat/tinacms-fumadocs-pkg init`.

It installs the adapter plus its 3 peer deps, writes the wired docs page and the keystroke-live island route (backing up any existing page to `.orig`), patches `next.config` and (for `src/` projects) the `tsconfig` `@tina/*` alias, then prints the one content-model edit to paste into `tina/config.ts`. Then run `pnpm dev` and open `/admin`.

> Installable from GitHub today (`github:0xharkirat/tinacms-fumadocs-pkg`); not yet on npm. Want to wire it by hand, or see exactly what `init` does? The manual steps below are precisely what it automates.

## Prerequisites

A Fumadocs **Next.js App Router** site that has already run `npx @tinacms/cli init` (gives you `tina/config.ts`, the `/admin` SPA, the generated client, and the wrapped dev script).

## Install

```bash
pnpm add @tinacms/bridge @mdx-js/mdx @tinacms/mdx tinacms-fumadocs-pkg
```

`next.config.mjs` (transpile the adapter's source):

```js
export default { transpilePackages: ['tinacms-fumadocs-pkg'] };
```

## Wire it (4 steps)

### 1. Schema: `tina/config.ts`

Model the `docs` collection and spread the stock-component templates. Import from the **`/templates` subpath** so the Tina config build never pulls in the client bridge:

```ts
import { fumadocsTemplates } from 'tinacms-fumadocs-pkg/templates';

// inside the `docs` collection:
ui: {
  router: ({ document }) => {
    const slug = document._sys.relativePath.replace(/\.mdx?$/, '');
    return slug === 'index' ? '/docs' : `/docs/${slug}`;
  },
},
fields: [
  { type: 'string', name: 'title', isTitle: true, required: true },
  { type: 'rich-text', name: 'body', isBody: true, templates: [...fumadocsTemplates] },
],
```

### 2. Docs page: `app/docs/[[...slug]]/page.tsx`

Fetch the doc via your generated client, stamp `tinaField` markers, inject the form payload, mount the bridge, and wrap the body in `<TinaIslandBody>` (the React-uncontrolled live container). The body itself still renders through Fumadocs' `<MDX>`. See the demo repo ([tinacms-fumadocs-poc](https://github.com/0xharkirat/tinacms-fumadocs-poc/blob/main/app/docs/%5B%5B...slug%5D%5D/page.tsx)) for the complete, working `page.tsx`; the essentials:

```tsx
import { prepareTinaForm, withTinaMarkers, TinaEditBridge, TinaIslandBody } from 'tinacms-fumadocs-pkg';
import { tinaIslandUrl, getIslandSeedHtml } from 'tinacms-fumadocs-pkg/island';
import { previewComponents } from 'tinacms-fumadocs-pkg/preview';

const tina = await client.queries
  .docs({ relativePath: page.path }, { fetchOptions: { cache: 'no-store' } })
  .then(prepareTinaForm).catch(() => null);     // degrade to plain Fumadocs if Tina is down

const islandUrl = tina ? tinaIslandUrl(params.slug) : undefined;
const seed = islandUrl
  ? await getIslandSeedHtml({ path: page.path, getRawText: () => page.data.getText('raw'),
                              getComponents: () => previewComponents(getMDXComponents()) })
  : undefined;
// ...stamp data-tina-field on title/body via tinaField + withTinaMarkers; render
// <TinaIslandBody islandUrl initialHtml={seed} remountKey={hash} ...><MDX/></TinaIslandBody>
```

### 3. Island route: `app/api/tina-island/docs/[[...slug]]/route.ts`

10 lines via the factory. **Supply `authorize` for production** (see *Security*):

```ts
import { createTinaIslandRoute } from 'tinacms-fumadocs-pkg/island';
import { previewComponents } from 'tinacms-fumadocs-pkg/preview';
import { source } from '@/lib/source';
import { getMDXComponents } from '@/components/mdx';
import { client } from '@/tina/__generated__/client';

export const dynamic = 'force-dynamic';
export const { POST } = createTinaIslandRoute({
  resolvePage: (slug) => {
    const page = source.getPage(slug);
    return page && { path: page.path, getRawText: () => page.data.getText('raw') };
  },
  getComponents: () => previewComponents(getMDXComponents()),
  fetchForm: (rel) => client.queries.docs({ relativePath: rel }, { fetchOptions: { cache: 'no-store' } }),
  // authorize: (req) => isYourTrustedPreview(req),   // see Security
});
```

### 4. Build script: `package.json`

Generate the Tina client during the build, or a clean clone's `next build` fails on the gitignored `tina/__generated__`:

```json
{ "scripts": { "build": "tinacms build --local -c \"next build\"" } }
```

## Security

The island route compiles the **untrusted** posted overlay through `@mdx-js/mdx`, which **evaluates `{…}` as server JS**. Two layers protect it:

- **`authorize`** is checked before any compile. **Default: dev-only** (`process.env.NODE_ENV !== 'production'`), so a deployed route is closed unless you pass a real check (Next.js `draftMode`, a preview secret, or admin-iframe origin verification). **You must supply this for cloud/production editing.**
- The preview compile **strips MDX expressions / ESM / expression JSX-props** from the parsed mdast, so attacker-supplied `{…}` (in text or props) can't reach the evaluator.

## Exports

| Import | Use |
|---|---|
| `prepareTinaForm(result)` | server: turn a client query result into `{ data, id, payload }` |
| `TinaEditBridge` | client: mounts `@tinacms/bridge`; live title patch + nav re-scan |
| `TinaIslandBody` | client: React-uncontrolled live body container (key-remounts on save) |
| `withTinaMarkers(components, bodyField)` | adds `data-tina-field` to a Fumadocs MDX map |
| `tinacms-fumadocs-pkg/templates` → `fumadocsTemplates` | Tina templates for stock Fumadocs components |
| `tinacms-fumadocs-pkg/island` → `createTinaIslandRoute`, `tinaIslandUrl`, `getIslandSeedHtml` | the island endpoint + helpers |
| `tinacms-fumadocs-pkg/preview` → `previewComponents` | preview-safe component map (markdown live, UI components → placeholders) |
| `tinacms-fumadocs-pkg/runtime` → `compileFumadocsMDX` | runtime Fumadocs MDX compile (used by the island) |

## Limitations

- **UI components are preview placeholders** (live only on non-RSC Fumadocs templates, where the body is client-rendered; future work). Markdown is fully live.
- The expression-strip also runs on the trusted seed compile, so a saved page using raw `{…}` / imports won't show those in the **live preview** (production, via Fumadocs' own renderer, is unaffected).
- Editing requires `tinacms dev` (the local content server) running; production builds degrade to plain Fumadocs.

## License

MIT
