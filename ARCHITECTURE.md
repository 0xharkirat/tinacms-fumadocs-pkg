# How tinacms-fumadocs-pkg works

> **The `.mdx` file on disk is the only thing TinaCMS and Fumadocs share.** Tina edits the file; Fumadocs renders the file. They never hand each other data in memory.

## What it does

Open `/admin`, click a doc, and edit it in a visual UI. As you type, the **real** Fumadocs components (Card, Callout, Tabs, and so on) re-render live in a preview. When you save, Tina writes the `.mdx` file. Your published site is unaffected: Fumadocs renders that same `.mdx` exactly as before.

So the adapter is **glue**, not a new CMS and not a new renderer. It connects two tools that already exist.

## The two halves of the problem

Visual editing needs two things, and they have very different shapes:

1. **A channel** between the editor UI and the page. It opens the form, pushes your unsaved keystrokes to the preview, and tracks what you clicked. This part is generic, the same for any framework, so we reuse TinaCMS's own **`@tinacms/bridge`** rather than reinvent it.
2. **A live preview** that turns your unsaved edit into the *real* Fumadocs components. This part is specific to Fumadocs (React and MDX on Next.js), and it is what this package actually builds.

## How the live preview works

This chain runs on every keystroke, **only inside the `/admin` editor**:

```
you type in the form
      │  @tinacms/bridge sends your unsaved edit (a JSON tree) to the page
      ▼
TinaLiveBody  (live-body.tsx, mounted only inside the /admin iframe)
      │  serializeMDX  →  turns the JSON tree back into an MDX string
      ▼
compileFumadocsMDXClient  (client-compile.ts, runs in the browser)
      │  @mdx-js/mdx compiles the string, wired with Fumadocs' own plugins
      │  (Shiki code highlighting, heading anchors, table of contents)
      │  + strip-mdx removes anything unsafe (see Security)
      ▼
executeMdx  (@fumadocs/mdx-remote/client)  →  a real React component
      ▼
<Body components={the real Fumadocs components} />     ← your live preview
```

The key move is that we compile and render **in the browser**, where Fumadocs' `'use client'` components can actually run, and we hand them the **real** component map. The preview is the genuine `<Card>`.

## Local and production editing

**Local editing** is the default. Run `pnpm dev`, open `localhost:3000/admin`, and edit. Each save writes straight to the `.mdx` file on disk; from there you commit and push like any other change, and your host (Vercel, Netlify, or similar) builds and publishes it.

For a visitor, none of the editor code runs. Outside the `/admin` iframe the page is just the normal Fumadocs render, so a deployed site behaves exactly like a plain Fumadocs site.

**Editing on the live site** is possible too, if you connect your deployment to **TinaCloud**. Then you can open `/admin` on the live URL and edit in production, where each save is a new commit to your underlying git repo. Turn on TinaCloud's **editorial workflow** and those saves land on a branch instead of `main`, so changes go through review before they reach production and `main` stays protected.

## The pieces

Eleven small source files, grouped by job.

**Describe what's editable**
- `templates.ts` defines one TinaCMS template per Fumadocs component (its fields). This is how a `<Card>` becomes an editable block in the form instead of raw text.
- `components.ts` maps each component name to its real implementation, so anything you can insert can also render.

**Connect the editor to the page** (wired into the `page.tsx` the CLI generates for you)
- `server.ts` turns the page's Tina query into the form payload the editor needs.
- `bridge.tsx` mounts `@tinacms/bridge` and opens the editor-to-page channel.
- `markers.tsx` stamps `data-tina-field` so clicking text in the preview focuses the right field.

**Render the live preview**
- `live-body.tsx` listens for your edits and re-renders.
- `client-compile.ts` compiles the MDX string in the browser (the engine).
- `strip-mdx.ts` is the security pass (see below).
- `live-error-boundary.tsx` keeps a half-finished component from crashing the preview (see below).
- `live-toc.tsx` keeps the "On this page" sidebar in sync as you edit headings.

(`index.ts` re-exports the public API.)

## Why the preview runs in the browser

Fumadocs' components are `'use client'` React components. A `<Card>`, for instance, pulls in browser-only code, so it can only mount in a browser, never on a server. That is why the preview compiles and renders client-side: it is the one place those components can actually run. Fumadocs ships the runtime engine for exactly this (`@fumadocs/mdx-remote`), so we did not have to write our own compiler.

> One wrinkle, in case you hit it. Fumadocs' one-call compiler imports `node:fs`, which Turbopack refuses to put in a browser bundle. So we compile with `@mdx-js/mdx` directly and pull in only the Fumadocs plugins we need by their deep import paths, leaving the `node:fs` one out. It is documented in `client-compile.ts`.

## Security

The preview **evaluates** your unsaved MDX as JavaScript, and editor content is untrusted. So before compiling, `strip-mdx.ts` removes anything that could run code or read state: `{expressions}`, imports, and non-literal JSX props such as `{process.env.SECRET}`. Safe literal props like `<Tabs items={['a','b']}/>` are kept. This only affects the preview; production uses Fumadocs' normal renderer and is unaffected.

## Resilience

While you are filling in a component, it is briefly incomplete. An empty `<InlineTOC>` has no items yet, for example, which can throw. `live-error-boundary.tsx` (its `toPreviewComponents` helper) wraps every previewed component in an error boundary and a `Suspense`, and adds small guards for the components that need props before they can render. A half-typed component then shows a small placeholder instead of blanking the whole preview, and it recovers the moment you finish it.

## What works, and what doesn't yet

**Editable with live preview:** Callout, Cards, Tabs, Steps, Accordions, Files, GitHub Info, Banner, and Inline TOC, plus standard markdown and a `meta.json` editor for the sidebar order and grouping.

**Limits**
- **Non-literal props do not show in the preview.** A prop like `{someVar}` is stripped for safety, so it is missing in the editor. It is correct on the published page.
- **Click-to-edit is field-level.** Clicking the body opens the whole body field, not one specific Card's fields.
- **Editing needs a content server.** That is `tinacms dev` locally, or TinaCloud in production. A plain build with neither just renders Fumadocs.

---

In one line: **reuse Tina's channel, compile and render the real components in the browser, and let Fumadocs and Tina meet only at the `.mdx` file.**
