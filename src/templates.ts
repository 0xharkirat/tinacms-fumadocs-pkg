// Tina `templates` for stock Fumadocs UI components, so they round-trip as
// editable blocks in the admin instead of opaque text. Spread the top-level
// set into your body rich-text field's `templates`:
//
//   import { fumadocsTemplates } from 'tinacms-fumadocs-pkg/templates';
//   // ...
//   { type: 'rich-text', name: 'body', isBody: true,
//     templates: [...fumadocsTemplates, ...yourCustomTemplates] }
//
// Import from the `/templates` subpath (not the package root) inside
// tina/config.ts, so the Tina config build never pulls in the client bridge.
//
// `template.name` must match the JSX component name Fumadocs renders. A
// component's child MDX content maps to a `children` rich-text field; nested
// components (Tab inside Tabs, etc.) are declared as that field's templates.

import type { Template } from 'tinacms';

// ── child-only blocks (only ever live inside a parent's `children` field) ─────

const Tab: Template = {
  name: 'Tab',
  label: 'Tab',
  fields: [
    { name: 'value', label: 'Tab label', type: 'string' },
    { name: 'children', label: 'Content', type: 'rich-text' },
  ],
};

const Step: Template = {
  name: 'Step',
  label: 'Step',
  fields: [{ name: 'children', label: 'Content', type: 'rich-text' }],
};

const Accordion: Template = {
  name: 'Accordion',
  label: 'Accordion',
  fields: [
    { name: 'title', label: 'Title', type: 'string' },
    { name: 'children', label: 'Content', type: 'rich-text' },
  ],
};

const FileItem: Template = {
  name: 'File',
  label: 'File',
  fields: [{ name: 'name', label: 'Name', type: 'string' }],
};

const Folder: Template = {
  name: 'Folder',
  label: 'Folder',
  fields: [
    { name: 'name', label: 'Name', type: 'string' },
    { name: 'defaultOpen', label: 'Open by default', type: 'boolean' },
    // Files only, ONE level deep. Nested folders would need Folder to reference
    // ITSELF, which makes Tina's schema validation recurse forever ("Maximum
    // call stack size exceeded" on dev start). So a folder holds files, and the
    // top-level <Files> holds files + folders — but folders don't nest.
    { name: 'children', label: 'Files', type: 'rich-text', templates: [FileItem] },
  ],
};

// ── Card ──────────────────────────────────────────────────────────────────────
// A single content card: a heading, an optional description, an optional link.
//
// Fumadocs renders a `<Card>` fine on its own; `<Cards>` is ONLY a responsive
// grid wrapper. So Card is exposed BOTH as a top-level block (drop one straight
// into the body) AND as a child of `Cards` (for a grid). One template, reused in
// both places — you never insert `Cards` just to add a single card.
//
// Fields are the minimal, faithfully-modelable subset of Fumadocs' CardProps.
// Deferred: `external` (a boolean, add when needed) and `icon` (a React node /
// JSX, which a flat field can't represent). `title` rich-text is a later step.
const Card: Template = {
  name: 'Card',
  label: 'Card',
  fields: [
    { name: 'title', label: 'Title', type: 'string', required: true },
    { name: 'description', label: 'Description', type: 'string' },
    { name: 'href', label: 'Link (href)', type: 'string' },
  ],
};

// ── top-level blocks (insertable directly in the doc body) ────────────────────

const Callout: Template = {
  name: 'Callout',
  label: 'Callout',
  fields: [
    { name: 'title', label: 'Title', type: 'string' },
    {
      name: 'type',
      label: 'Type',
      type: 'string',
      // fumadocs-ui CalloutType (v16). Verify against your installed version.
      options: ['info', 'warn', 'warning', 'error', 'success', 'idea'],
    },
    { name: 'children', label: 'Content', type: 'rich-text' },
  ],
};

const Cards: Template = {
  name: 'Cards',
  label: 'Cards',
  // A responsive grid of cards. Reuses the single `Card` template above as its
  // only nested block (DRY) — editing a card is identical inside or outside Cards.
  fields: [{ name: 'children', label: 'Cards', type: 'rich-text', templates: [Card] }],
};

const Tabs: Template = {
  name: 'Tabs',
  label: 'Tabs',
  fields: [
    { name: 'items', label: 'Tab labels', type: 'string', list: true },
    { name: 'children', label: 'Tabs', type: 'rich-text', templates: [Tab] },
  ],
};

const Steps: Template = {
  name: 'Steps',
  label: 'Steps',
  fields: [{ name: 'children', label: 'Steps', type: 'rich-text', templates: [Step] }],
};

const Accordions: Template = {
  name: 'Accordions',
  label: 'Accordions',
  fields: [
    {
      // Required by Fumadocs/Radix. "single" = one open at a time, "multiple" =
      // any number. WITHOUT this field, parsing <Accordions type="…"> fails with
      // "Unable to parse rich-text".
      name: 'type',
      label: 'Type',
      type: 'string',
      options: ['single', 'multiple'],
    },
    { name: 'children', label: 'Accordions', type: 'rich-text', templates: [Accordion] },
  ],
};

const Files: Template = {
  name: 'Files',
  label: 'Files',
  fields: [{ name: 'children', label: 'Files', type: 'rich-text', templates: [FileItem, Folder] }],
};

// ── GithubInfo ────────────────────────────────────────────────────────────────
// A repo badge (stars / forks). `owner` + `repo` are the only required props and
// the only ones a flat field can faithfully model. `token` is intentionally NOT
// exposed: it is a secret that would land in committed MDX, and public repos need
// none. The other props (baseUrl, locale, fetchOptions) are advanced/optional and
// omitted to keep the form clean.
const GithubInfo: Template = {
  name: 'GithubInfo',
  label: 'GitHub Info',
  fields: [
    { name: 'owner', label: 'Owner', type: 'string', required: true },
    { name: 'repo', label: 'Repository', type: 'string', required: true },
  ],
};

// ── Banner ────────────────────────────────────────────────────────────────────
// A site-wide notice bar that wraps its content. `id` is optional but enables the
// per-user dismiss button + localStorage memory, so it's worth exposing. `variant`
// uses the component's own BannerVariant union ('normal' | 'rainbow'). The wrapped
// content maps to a `children` rich-text field. height / rainbowColors / changeLayout
// are advanced styling props, omitted to keep the form minimal.
const Banner: Template = {
  name: 'Banner',
  label: 'Banner',
  fields: [
    { name: 'id', label: 'ID (enables dismiss + memory)', type: 'string' },
    {
      name: 'variant',
      label: 'Variant',
      type: 'string',
      // BannerVariant union from fumadocs-ui banner.tsx.
      options: ['normal', 'rainbow'],
    },
    { name: 'children', label: 'Content', type: 'rich-text' },
  ],
};

// ── InlineTOC ─────────────────────────────────────────────────────────────────
// A collapsible, in-body table of contents. Its `items` prop is `TOCItemType[]`
// ({ title, url, depth }), modeled here as a Tina OBJECT list (list:true on a
// `type:'object'` field). Tina serialises this as an array-of-object-literals JSX
// prop — `items={[{ title:'…', url:'#…', depth:2 }]}` — which the live-preview
// strip-mdx safe-literal allowlist preserves (every leaf is a string/number
// literal), so the TOC survives the strip and renders live. `depth` is a number
// so the component's indentation math works.
const InlineTOC: Template = {
  name: 'InlineTOC',
  label: 'Inline TOC',
  fields: [
    {
      name: 'items',
      label: 'Items',
      type: 'object',
      list: true,
      // Show a readable label per row in the Tina list UI.
      ui: { itemProps: (item) => ({ label: item?.title || 'Item' }) },
      fields: [
        { name: 'title', label: 'Title', type: 'string', required: true },
        { name: 'url', label: 'URL (e.g. #section)', type: 'string', required: true },
        { name: 'depth', label: 'Depth', type: 'number' },
      ],
    },
  ],
};

/**
 * Top-level Tina templates for stock Fumadocs UI components.
 *
 * `Card` appears here (standalone) AND inside `Cards` (grid). The other nested
 * blocks (Tab, Step, Accordion, File, Folder) are reachable only inside their
 * parents.
 *
 * Not included (round-trip as plain text, not visually editable — Jack's list):
 * TypeTable (nested JSON prop), components with icon/render/callback props.
 */
export const fumadocsTemplates: Template[] = [
  Callout,
  Card,
  Cards,
  Tabs,
  Steps,
  Accordions,
  Files,
  GithubInfo,
  Banner,
  InlineTOC,
];
