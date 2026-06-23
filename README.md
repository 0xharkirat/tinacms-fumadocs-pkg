# tinacms-fumadocs-pkg

Add **TinaCMS** visual editing to a **Fumadocs** (Next.js App Router) site **without reimplementing Fumadocs' renderer**. The `.mdx` file on disk is the only contract: TinaCMS edits it, Fumadocs compiles it.

**What you get:** the docs body updates **per keystroke** in the editor. Markdown (headings, bold/italic, links, lists, tables, images, and **code blocks with real Shiki**) is compiled live through Fumadocs' own runtime MDX. Production is untouched; the editing layer only runs inside the admin iframe.

**What you don't (yet):** Fumadocs' `'use client'` UI components (`Card`, `Callout`, `Tabs`, `Steps`, `Accordions`, `Files`, …) can't be invoked by the server-side preview compile, so they show an honest, labelled placeholder in the editor and render for real on your published page. See [Limitations](#limitations).

## Quick start

Zero to a visually-editable Fumadocs site, from scratch:

```bash
pnpm create fumadocs-app          # 1. a Fumadocs site (pick the "Next.js: Fumadocs MDX" template)
cd your-app
pnpm dlx @tinacms/cli@latest init # 2. add TinaCMS (framework "Other", PNPM, TypeScript "yes")
pnpm dlx github:0xharkirat/tinacms-fumadocs-pkg init   # 3. add this adapter (wires everything)
pnpm dev                          # 4. run it
```

Open **http://localhost:3000/admin**, click a doc, and start editing. There are **no files to wire by hand**; step 3 does it all.

> **Use `pnpm dlx`, not `npx`.** npm's strict peer resolution rejects the fetch (`fumadocs-core` wants `react-router` 7, `tinacms` brings 6); pnpm is lenient. On an npm-only project: `npm_config_legacy_peer_deps=true npx github:0xharkirat/tinacms-fumadocs-pkg init`.

Already have a Fumadocs site? Skip step 1. Already ran `@tinacms/cli init`? Skip step 2. The adapter's `init` is idempotent, so re-running it detects what's already wired and skips it.

## What `init` does

One command, fully reversible, so you can trust it:

| It | …does this |
|---|---|
| **installs** | the adapter + its 3 peer deps (`@tinacms/bridge`, `@tinacms/mdx`, `@mdx-js/mdx`) |
| **writes** | the docs page `app/docs/[[...slug]]/page.tsx` (your original goes to `page.tsx.orig`) and the keystroke-live island route `app/api/tina-island/.../route.ts` |
| **edits `tina/config.ts`** | replaces Tina's sample collection with a Fumadocs `docs` collection (kebab routes + the Embed-menu templates) |
| **edits `components/mdx.tsx`** | spreads `fumadocsComponents` into `getMDXComponents`, so `Steps`/`Accordions`/`Files` render on the page |
| **patches `next.config`** | adds `transpilePackages: ['tinacms-fumadocs-pkg']` (the adapter ships TypeScript) |
| **patches `package.json`** | wraps your dev script: `tinacms dev -c "next dev"` |
| **plus** | the `@tina/*` tsconfig alias for `src/` projects, and gitignores `public/admin` |

Anything it can't safely auto-edit (a customised config, an unusual layout) it **prints for you to paste**, and the summary tells you exactly what's left.

> **Deploying?** A clean clone's `next build` fails on the gitignored `tina/__generated__`, so set your build script to `tinacms build --local -c "next build"`. (Local dev doesn't need this; `tinacms dev` generates the client.)

## Limitations

- **UI components are preview placeholders**, live only on non-RSC Fumadocs templates, where the body is client-rendered (future work). Markdown is fully live, and every component renders for real on the published page.
- The preview strips MDX expressions / imports for safety, so a saved page using raw `{…}` won't show those in the **live preview** (production, via Fumadocs' own renderer, is unaffected).
- Editing needs `tinacms dev` running (the local content server). Production builds degrade to plain Fumadocs if Tina is unreachable.

## Security

The island route compiles the **untrusted** posted overlay through `@mdx-js/mdx`, which evaluates `{…}` as server JS. Two layers protect it:

- **`authorize`** runs before any compile. **Default: dev-only** (`NODE_ENV !== 'production'`), so a deployed route is closed unless you pass a real check (Next.js `draftMode`, a preview secret, or admin-iframe origin verification). **You must supply this for cloud/production editing.**
- The preview compile **strips MDX expressions / ESM / expression JSX-props** from the parsed mdast, so attacker-supplied `{…}` can't reach the evaluator.

## Exports

| Import | Use |
|---|---|
| `tinacms-fumadocs-pkg` → `prepareTinaForm`, `TinaEditBridge`, `TinaIslandBody`, `withTinaMarkers` | the docs-page building blocks |
| `tinacms-fumadocs-pkg/templates` → `fumadocsTemplates` | Tina templates for stock Fumadocs components (the editor's Embed menu) |
| `tinacms-fumadocs-pkg/components` → `fumadocsComponents` | the matching render components, spread into `getMDXComponents` |
| `tinacms-fumadocs-pkg/island` → `createTinaIslandRoute`, `tinaIslandUrl`, `getIslandSeedHtml` | the island endpoint + helpers |
| `tinacms-fumadocs-pkg/preview` → `previewComponents` | preview-safe component map (markdown live, UI components → placeholders) |

<details>
<summary><strong>Manual setup</strong> (exactly what <code>init</code> automates, by hand)</summary>

For when you want to wire it yourself, or `init` couldn't edit a customised file.

**1. Install** (the adapter ships TS, hence `transpilePackages`):

```bash
pnpm add @tinacms/bridge @mdx-js/mdx @tinacms/mdx tinacms-fumadocs-pkg
```

```js
// next.config.mjs
export default { transpilePackages: ['tinacms-fumadocs-pkg'] /* plus your existing config */ };
```

**2. Schema** in `tina/config.ts`: model the `docs` collection and spread the templates (import from the **`/templates`** subpath so the config build never pulls in the client bridge):

```ts
import { fumadocsTemplates } from 'tinacms-fumadocs-pkg/templates';
// inside schema.collections, replacing the sample:
{
  name: 'docs', label: 'Docs', path: 'content/docs', format: 'mdx',
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
}
```

**3. Components** in `components/mdx.tsx`: spread the render half so inserted components render:

```ts
import { fumadocsComponents } from 'tinacms-fumadocs-pkg/components';
// return { ...defaultMdxComponents, ...fumadocsComponents, ...components };
```

**4. Docs page + island route**: copy `app/docs/[[...slug]]/page.tsx` and `app/api/tina-island/docs/[[...slug]]/route.ts` verbatim from the [demo repo](https://github.com/0xharkirat/tinacms-fumadocs-poc). The page fetches the doc, stamps `tinaField` markers, mounts the bridge, and wraps the body in `<TinaIslandBody>`; the route is 10 lines via `createTinaIslandRoute` (**supply `authorize` for production**; see [Security](#security)).

**5. Scripts**: `dev` is `tinacms dev -c "next dev"`; `build` (for deploy) is `tinacms build --local -c "next build"`.

</details>

## License

MIT
