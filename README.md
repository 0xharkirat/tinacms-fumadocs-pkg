# tinacms-fumadocs-pkg

Add **TinaCMS** visual editing to a **Fumadocs** (Next.js App Router) site **without reimplementing Fumadocs' renderer**. The `.mdx` file on disk is the only contract: TinaCMS edits it, Fumadocs compiles it.

**What you get:** open `/admin`, edit a doc, and the **real** Fumadocs components (`Card`, `Callout`, `Tabs`, `Steps`, `Accordions`, `Files`, `GithubInfo`, `Banner`, `InlineTOC`) render **live in the editor, per keystroke** — no placeholders. Real Shiki highlighting, heading anchors, and a live "On this page" TOC. You can also reorder the sidebar by editing `meta.json`. Production is untouched: it is the normal Fumadocs render of the same file.

> **How?** The editor compiles your unsaved edit **in the browser** through Fumadocs' own runtime MDX engine (`@fumadocs/mdx-remote`), where the real client components run. Nothing replaces Fumadocs' renderer; the two systems meet only at the `.mdx` file. See [ARCHITECTURE.md](./ARCHITECTURE.md).

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

Already have a Fumadocs site? Skip step 1. Already ran `@tinacms/cli init`? Skip step 2. The adapter's `init` is idempotent: re-running it detects what's already wired and skips it.

## What `init` does

One command, fully reversible, so you can trust it:

| It | …does this |
|---|---|
| **installs** | the adapter + its 4 peer deps (`@tinacms/bridge`, `@tinacms/mdx`, `@mdx-js/mdx`, `@fumadocs/mdx-remote`) |
| **writes** | the docs page `app/docs/[[...slug]]/page.tsx` (your original goes to `page.tsx.orig`) and the client live-body boundary `components/tina-live-body.tsx` |
| **edits `tina/config.ts`** | replaces Tina's sample collection with a Fumadocs `docs` collection (kebab routes, the Embed-menu templates, Embed pinned to the front of the toolbar) **and** adds a `meta` collection for editing `meta.json` navigation |
| **edits `components/mdx.tsx`** | spreads `fumadocsComponents` into `getMDXComponents`, so `Steps`/`Accordions`/`Files`/`GithubInfo`/`Banner`/`InlineTOC` render on the page |
| **patches `next.config`** | adds `transpilePackages: ['tinacms-fumadocs-pkg']` (the adapter ships TypeScript) |
| **patches `package.json`** | wraps your dev script: `tinacms dev -c "next dev"` |
| **plus** | the `@tina/*` tsconfig alias for `src/` projects, and gitignores `public/admin` |

Anything it can't safely auto-edit (a customised config, an unusual layout) it **prints for you to paste**, and the summary tells you exactly what's left.

> **Deploying?** A clean clone's `next build` fails on the gitignored `tina/__generated__`, so set your build script to `tinacms build --local -c "next build"`. (Local dev doesn't need this; `tinacms dev` generates the client.)

## How it works

- **Production:** 100% Fumadocs. The page compiles `.mdx` through Fumadocs' normal pipeline; the adapter is dormant.
- **In the editor (admin iframe only):** `<TinaLiveBody>` listens for the bridge's unsaved-edit overlay, serialises this doc's body back to MDX, compiles it **client-side** via `@fumadocs/mdx-remote`, and renders the **real** component map. React owns the subtree, so there is no server roundtrip and no placeholder.
- **The contract:** the `.mdx` (and `meta.json`) file on disk. Tina writes it; Fumadocs reads it. They never share an in-memory format.

Full walkthrough: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Security

The editor's live preview compiles the **untrusted** unsaved overlay (it evaluates MDX `{…}` as JS), so before every compile the adapter strips anything executable from the parsed tree (`src/strip-mdx.ts`):

- node-level `{…}` expressions and `import` / `export` are removed;
- an expression-valued JSX prop survives **only if it is a pure compile-time literal** (a string/number/bool/null, or an array/object built entirely of those) — a safe-literal allowlist that keeps `<Tabs items={['a','b']}/>` while stripping `{process.env.X}`, `{someVar}`, calls, templates, JSX, and spreads.

This runs **client-side, in the admin iframe only**. There is no server endpoint and no `authorize` step to configure: production never compiles overlays, it just renders the saved file with Fumadocs.

## Limitations

- **Non-literal expression props are dropped in the live preview.** A prop like `{someVar}` or `{process.env.X}` is stripped for safety, so a component depending on a runtime-expression prop renders without it **in the editor** (it is correct on the published page).
- **`TypeTable` is not visually editable** (its `type` prop is a nested object-of-objects with no flat Tina field); it round-trips as text.
- **Click-to-edit is field-level**, not per-component: clicking the body focuses the whole body field, not a single component's fields.
- **`meta.json` nav editing is v1**: you type Fumadocs' tokens (`...`, `---Label---`, `[Text](url)`) into the reorderable `pages` list.
- Editing needs `tinacms dev` running (the local content server). Production builds degrade to plain Fumadocs if Tina is unreachable.

## Exports

| Import | Use |
|---|---|
| `tinacms-fumadocs-pkg` → `prepareTinaForm`, `TinaEditBridge`, `TinaLiveBody`, `TinaDocsPage`, `withTinaMarkers` | the docs-page building blocks |
| `tinacms-fumadocs-pkg/templates` → `fumadocsTemplates` | Tina templates for stock Fumadocs components (the editor's Embed menu) |
| `tinacms-fumadocs-pkg/components` → `fumadocsComponents` | the matching render components, spread into `getMDXComponents` |

<details>
<summary><strong>Manual setup</strong> (exactly what <code>init</code> automates, by hand)</summary>

For when you want to wire it yourself, or `init` couldn't edit a customised file.

**1. Install** (the adapter ships TS, hence `transpilePackages`):

```bash
pnpm add @tinacms/bridge @tinacms/mdx @mdx-js/mdx @fumadocs/mdx-remote tinacms-fumadocs-pkg
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
    {
      type: 'rich-text', name: 'body', isBody: true,
      templates: [...fumadocsTemplates],
      // Pin the Embed/insert control to the FRONT of the toolbar (Tina renders
      // the toolbar in this order; 'embed' only shows when `templates` exist).
      toolbarOverride: ['embed', 'heading', 'link', 'image', 'quote', 'ul', 'ol', 'bold', 'italic', 'code', 'codeBlock', 'table', 'strikethrough', 'mermaid', 'raw', 'hr'],
    },
  ],
}
```

**2b. Navigation (optional)**: add a second collection over the same `content/docs` path, scoped to `meta.json`, to edit Fumadocs' sidebar (titles, ordering, separators, links) in the admin. It coexists with `docs` because the format + match differ. Editing is save-refresh (reorder `pages`, save, refresh the page):

```ts
{
  name: 'meta', label: 'Navigation (meta.json)', path: 'content/docs',
  format: 'json', match: { include: '**/meta' },
  fields: [
    { type: 'string', name: 'title' },
    { type: 'boolean', name: 'defaultOpen' },
    { type: 'boolean', name: 'root' },
    { type: 'string', name: 'pagesIndex' },
    {
      type: 'string', name: 'pages', list: true,
      description: '"slug"=page/folder · "..."=everything else (keep last) · "---Label---"=separator · "[Text](url)"=link · "!slug"=hide',
    },
  ],
}
```

**3. Components** in `components/mdx.tsx`: spread the render half so inserted components render:

```ts
import { fumadocsComponents } from 'tinacms-fumadocs-pkg/components';
// return { ...defaultMdxComponents, ...fumadocsComponents, ...components };
```

**4. Docs page + live body**: copy `app/docs/[[...slug]]/page.tsx` and `components/tina-live-body.tsx` from the package's [`templates/`](https://github.com/0xharkirat/tinacms-fumadocs-pkg/tree/main/templates) directory. The page fetches the doc, stamps `tinaField` markers, mounts `<TinaEditBridge>`, renders the page via `<TinaDocsPage>` (live TOC), and wraps the body in `<TinaLiveBodyClient>` (the `'use client'` boundary that binds the real `getMDXComponents`). No API route and no `authorize`: the live render is client-side.

**5. Scripts**: `dev` is `tinacms dev -c "next dev"`; `build` (for deploy) is `tinacms build --local -c "next build"`.

</details>

## License

MIT
