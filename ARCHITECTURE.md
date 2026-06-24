# tinacms-fumadocs-pkg: how it works

A walkthrough for reviewers. Reads top to bottom; each section answers one question.

---

## 1. What is this package?

It adds **TinaCMS visual editing to a Fumadocs (Next.js App Router) site** without
reimplementing Fumadocs' renderer. The contract is one sentence:

> The `.mdx` file on disk is the only thing Tina and Fumadocs share. **Tina edits
> the file; Fumadocs renders the file.** They never share an in-memory format.

What you get: open `/admin`, edit a doc, and the **real** Fumadocs components
(Card, Callout, Tabs, Steps, Accordions, Files) render **live in the editor as you
type**, with no placeholders. On the published site nothing changes: it is the
normal Fumadocs render of the same file.

---

## 2. Is it a copy of `@tinacms/bridge` or `@tinacms/astro`?

**No.** It is new glue code that **depends on** one Tina package and reuses none of
another:

| Package | Relationship |
|---|---|
| `@tinacms/bridge` | **Dependency.** We import it (`init`, `refreshForms`, `addMetadata`, `hashFromQuery`, `tinaField`). It is framework-agnostic plumbing: the admin↔page postMessage channel, form discovery, and click-to-edit markers. We do not fork or copy it. |
| `@tinacms/astro` | **Not used at all.** It is Tina's Astro integration; it renders `.astro` components via Astro's `experimental_AstroContainer`. That engine cannot render React/Fumadocs. |
| `@tinacms/mdx` | **Dependency.** `serializeMDX` turns Tina's rich-text JSON back into an MDX string. |
| `tinacms` | **Dependency** (type only): the `Template` type for the editing schema. |

So this package is the **Next.js/Fumadocs analog of what `@tinacms/astro` is for
Astro**, but with a completely different render engine (see section 6). The
*plumbing* (bridge) is shared; the *render* is ours.

---

## 3. Why not just use the bridge / Astro package and "extend Fumadocs components"?

Because the two halves of visual editing have different portability:

- **The channel is framework-agnostic** (open the form, push unsaved edits, mark
  click-to-edit targets). That is exactly `@tinacms/bridge`, and we **do** just use
  it. No reinvention there.
- **The live render is framework-specific.** To show the unsaved edit, something
  has to turn the in-memory content into the framework's real components:
  - Astro does it with `experimental_AstroContainer` rendering `.astro` files.
  - Fumadocs is **React + MDX on Next.js**, so it needs a React render of MDX, which
    Astro's container cannot produce. You cannot point the Astro renderer at a
    Fumadocs `<Card>`.

And "just extend the Fumadocs components" is not the missing piece: the real
components already render fine (they do on every published page). The missing
pieces are (a) the **editing schema** that lets Tina round-trip them as blocks, and
(b) a **live render of the unsaved file** through Fumadocs' own pipeline. The bridge
gives neither; this package adds both.

---

## 4. Which packages does it use, and for what?

| Package | Used for |
|---|---|
| `@tinacms/bridge` | admin↔page channel (`init`), form discovery (`refreshForms` + the `data-tina-form` payload), `_content_source` metadata (`addMetadata`), the form id (`hashFromQuery`), click-to-edit (`tinaField`). |
| `@tinacms/mdx` | `serializeMDX`: Tina rich-text AST → MDX string (so the edit can be recompiled). |
| `@fumadocs/mdx-remote` | Fumadocs' own **runtime** MDX engine. We use its **client** render half (`/client` → `executeMdx`) to evaluate compiled MDX into real components in the browser. |
| `@mdx-js/mdx` | the actual MDX `compile()` (string → JS), wired with Fumadocs' remark/rehype plugins. |
| `tinacms` | the `Template` type for `fumadocsTemplates`. |

No project-specific code is imported: the page passes in its own generated Tina
client and `getMDXComponents`; the package never reaches into the host app.

---

## 5. The architecture (the data flow)

Ten source files, three concerns:

**A. Editing schema (what the form looks like)**
- `templates.ts` → `fumadocsTemplates`: one Tina `Template` per Fumadocs component
  (Callout, Card/Cards, Tabs, Steps, Accordions, Files). Spread into the docs
  collection's body rich-text field in `tina/config.ts`. This is how a `<Card>` in
  the file round-trips as an editable block instead of opaque text.
- `components.ts` → `fumadocsComponents`: the matching **real** components, spread
  into `getMDXComponents` so they render on the page.

**B. Page wiring (`templates/page.tsx`, emitted by the CLI)**
1. Render the body the normal Fumadocs way: `const MDX = page.data.body; <MDX/>`.
2. Also fetch the same file via the generated Tina client, and `prepareTinaForm`
   (`server.ts`) it into a form id + a hidden `<div data-tina-form>` payload.
3. Mount `<TinaEditBridge>` (`bridge.tsx`) → `init()` connects the channel; the
   bridge discovers the form from that payload.
4. Stamp click-to-edit markers: `data-tina-field` on `<DocsTitle>` (a leaf string,
   live-patched in place) and on `<DocsBody>` + each `<p>` (`withTinaMarkers`,
   `markers.tsx`) so clicking prose focuses the **body** field.
5. Wrap the body in `<TinaLiveBody>` (via a thin `'use client'` wrapper, because a
   Server Component can't pass the `getComponents` function prop directly).

**C. Live render (`live-body.tsx` + `client-compile.ts`), only inside the admin iframe**
- Outside the iframe (every visitor, and the editor's first paint): render the real
  `<MDX/>` verbatim. Production is untouched.
- Inside the iframe, on each `updateData` overlay from the bridge:
  1. pull this doc's body AST out of the overlay,
  2. `serializeMDX(ast)` → MDX string,
  3. `compileFumadocsMDXClient(mdx)` → compile in the browser and evaluate into a
     real `MdxContent` component,
  4. render `<Body components={getMDXComponents()}/>` → the **real** components,
     live. React owns this subtree the whole time.

```
  edit in /admin form
        │  bridge postMessage: updateData(overlay)
        ▼
  TinaLiveBody  ──serializeMDX──▶  MDX string
        │
        ▼  compileFumadocsMDXClient (browser)
   @mdx-js/mdx compile  +  Fumadocs plugins (gfm, heading, rehypeCode=Shiki, toc)
        │  + strip-mdx (security)
        ▼  @fumadocs/mdx-remote/client executeMdx
   real MdxContent  ──▶  <Body components={REAL Fumadocs components}/>  (live)
```

`strip-mdx.ts` is a shared security pass: the compiler evaluates `{…}` as JS, and
the overlay is untrusted, so it removes MDX expressions / imports from the parsed
tree before compile (covers body text and JSX props alike).

---

## 6. What changed to make it work? (the key shift)

This is the whole story.

**Before:** the live preview was a **server** render. The bridge POSTed the overlay
to a Next route that compiled it and ran `renderToStaticMarkup`. But
`renderToStaticMarkup` cannot run React `'use client'` components (and Fumadocs
components transitively need the browser, e.g. `Card → Link`), so the preview
substituted **placeholders** ("renders on your site"). Only plain markdown was real.

**After:** the live preview is a **client** render. We compile and render the body
**in the editor's browser**, where the `'use client'` components actually run. So
the real `<Card>` mounts with its real chrome, live. The shift is one sentence:

> Render the unsaved body **where the client components can run** (the browser),
> instead of on the server where they can't.

Fumadocs already ships the engine for this (`@fumadocs/mdx-remote`); we did not have
to hand-roll a compiler. The whole old server-island path (`island.ts`,
`preview.ts`, `island-body.tsx`, `runtime.ts`, the API route) became dead and was
removed.

**The one wrinkle: `node:fs` in the browser bundle.** `@fumadocs/mdx-remote`'s
one-call `createCompiler` statically imports the `fumadocs-core/mdx-plugins`
*barrel*, which re-exports `remark-image` → `node:fs`. Turbopack refuses `node:fs`
in a client bundle, so that one-liner 500s (and `remarkImageOptions:false` does not
help, since the *import* is resolved at build time regardless of the runtime flag).
Fix: import the few plugins we need by **deep subpath** (`…/rehype-code`, etc.),
omit `remark-image`, compile with `@mdx-js/mdx`, and render with the package's
`/client` half. No `node:fs` enters the browser graph; zero config for installers.

---

## 7. DRY / SRP / KISS / minimal?

- **DRY:** yes. The security strip is one shared module (`strip-mdx.ts`) used by the
  compiler. The `Card` template is defined once and reused both top-level and inside
  `Cards`. The real component map (`getMDXComponents`) is reused for both the page
  render and the live render, so there is no second component list to keep in sync.
- **SRP:** yes. Each module owns one job: `client-compile` = compile, `live-body` =
  the live React component, `strip-mdx` = security, `bridge` = the channel, `server`
  = form prep, `markers` = click-to-edit stamping, `templates` = the schema,
  `components` = the render map.
- **KISS:** mostly. The core idea (render client-side) is simple, and we reuse
  Fumadocs' own engine rather than building one. The honest non-simple bit is the
  `node:fs` workaround (deep-subpath plugin imports), which is forced by Turbopack,
  not a choice; it is documented at length in `client-compile.ts`.
- **Minimal:** yes. Ten source files; the live-render switch was net **−829/+86**
  lines (the server-island path was deleted). Dependencies are only the necessary
  Tina + MDX packages, all peers. The `init` CLI auto-wires a consumer in one
  command.

---

## 8. Current capabilities and known limits

**Works live (real components):** Callout, Card/Cards, Tabs, Steps, Accordions, Files.

**Resolved (were limits in an earlier draft):**
- **Tabs/Steps literal props render live.** A safe-literal allowlist in the strip
  keeps compile-time literal JSX props (`items={['a','b']}`, `{3}`, `{{open:true}}`),
  so Tabs shows its tab list live, while every non-literal expression is still
  stripped. See `strip-mdx.ts`.
- **TOC is live.** Heading edits update the sidebar via `TinaDocsPage` (a client
  `<DocsPage>` wrapper that holds toc state); `live-body` pushes each recompiled toc
  through `TocContext`. See `live-toc.tsx`.

**Known limits (all documented in code):**
- **Non-literal expression props are stripped in the preview.** A prop reading state
  or env (`{someVar}`, `{process.env.X}`) is removed before the untrusted preview
  compile (safe + correct), so a component depending on a runtime-expression prop
  renders without it in the live preview. It is correct on the published page.
- **Click-to-edit is field-level, not per-component.** Clicking the body focuses the
  whole body field, not a specific Card's fields. Per-component editing would need
  each rendered component to stamp its own `tinaField` marker.
- **Editing needs `tinacms dev` running** (the local content server); production
  builds degrade to plain Fumadocs if it is unreachable.
