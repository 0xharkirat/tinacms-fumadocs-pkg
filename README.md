# tinacms-fumadocs-pkg

**Visual editing for [Fumadocs](https://fumadocs.dev).** Edit your docs in a clean UI and watch the real Fumadocs components update live as you type. Your `.mdx` files stay the source of truth.

## Quick start

```bash
pnpm create fumadocs-app                              # 1. a Fumadocs site (pick "Next.js: Fumadocs MDX", then keep everything to default)
cd your-app
pnpm dlx @tinacms/cli@latest init                     # 2. add TinaCMS (pick "Other", then "PNPM", then keep everything to default)
pnpm dlx github:0xharkirat/tinacms-fumadocs-pkg init  # 3. add this adapter (wires everything)
pnpm dev                                              # 4. run it
```

Open **http://localhost:3000/admin**, click a doc, and edit.

> Use `pnpm dlx`, not `npx`, because npm's strict peer resolution rejects the install.

## Supported components

Every stock Fumadocs component, editable with a live preview:

### Callout
![Callout](docs/screenshots/callout.png)

### Cards
![Cards](docs/screenshots/cards.png)

### Tabs
![Tabs](docs/screenshots/tabs.png)

### Steps
![Steps](docs/screenshots/steps.png)

### Accordions
![Accordions](docs/screenshots/accordions.png)

### Files
![Files](docs/screenshots/files.png)

### GitHub Info
![GitHub Info](docs/screenshots/github-info.png)

### Banner
![Banner](docs/screenshots/banner.png)

### Inline TOC
![Inline TOC](docs/screenshots/inline-toc.png)

Plus all standard markdown (headings, lists, tables, links, images, and code blocks with real Shiki) and a **`meta.json` sidebar editor** for ordering and grouping pages.

## How it works

The `.mdx` file on disk is the only contract: TinaCMS edits it, Fumadocs renders it. In the editor, the preview compiles your unsaved edit in the browser through Fumadocs' own engine, so you see the **real** components. Production is 100% Fumadocs. Details in [ARCHITECTURE.md](./ARCHITECTURE.md).

<details>
<summary><strong>Manual setup</strong> — skip if you ran <code>init</code></summary>

1. **Install** and transpile:
   ```bash
   pnpm add @tinacms/bridge @tinacms/mdx @mdx-js/mdx @fumadocs/mdx-remote tinacms-fumadocs-pkg
   ```
   ```js
   // next.config.mjs
   export default { transpilePackages: ['tinacms-fumadocs-pkg'] };
   ```
2. **Schema** (`tina/config.ts`): add a `docs` collection with `templates: [...fumadocsTemplates]` (from `tinacms-fumadocs-pkg/templates`) on the body field, and a `meta` collection (`format: 'json'`, `match: { include: '**/meta' }`) for the sidebar.
3. **Components** (`components/mdx.tsx`): spread `fumadocsComponents` (from `tinacms-fumadocs-pkg/components`) into `getMDXComponents`.
4. **Page**: copy `app/docs/[[...slug]]/page.tsx` and `components/tina-live-body.tsx` from the package's [`templates/`](https://github.com/0xharkirat/tinacms-fumadocs-pkg/tree/main/templates).
5. **Scripts**: `dev` = `tinacms dev -c "next dev"`; deploy build = `tinacms build --local -c "next build"`.

</details>

## License

MIT
