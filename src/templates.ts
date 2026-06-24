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

// ── shared nested-toolbar tiers ───────────────────────────────────────────────
// Every NESTED rich-text field (a `children` inside a component) gets an explicit
// toolbar via `overrides: { toolbar: [...] }` — the current Tina API
// (`toolbarOverride` is deprecated). Two reasons to set it:
//   1. Consistency: an unconfigured rich-text field defaults to embed-LAST + the
//      full toolbar. Pinning 'embed' FIRST makes the insert-block control land in
//      the same spot everywhere (matching the body field in bin/cli.mjs).
//   2. Fit: a file tree wants almost no formatting; prose-in-a-box wants most of
//      it. Three tiers cover every nested field below.
// Defined once and reused (DRY) — pick the tier that matches the field's layout.

// `as const` keeps each token a string LITERAL so the arrays match Tina's
// `ToolbarOverrideType[]` (a union of those literals) instead of widening to
// string[]. At each use site we spread (`[...TIER]`) into a fresh mutable array,
// which is what `overrides.toolbar` expects. Every token below is a member of
// ToolbarOverrideType in @tinacms/schema-tools.

// Prose that can sit at full width, so a block image reads fine.
const NESTED_WITH_IMAGE = ['embed', 'bold', 'italic', 'link', 'image', 'code', 'ul', 'ol', 'quote'] as const;
// Prose in a narrow/coloured box (Callout, Banner) — drop 'image' (a full-bleed
// image looks wrong inside a tight notice), keep the rest.
const NESTED_NO_IMAGE = ['embed', 'bold', 'italic', 'link', 'code', 'ul', 'ol', 'quote'] as const;
// File trees (Files / Folder children): not prose. The only useful insert is the
// File/Folder block itself, so expose 'embed' alone.
const EMBED_ONLY = ['embed'] as const;

// ── child-only blocks (only ever live inside a parent's `children` field) ─────

const Tab: Template = {
  name: 'Tab',
  label: 'Tab',
  fields: [
    {
      name: 'value',
      label: 'Label (must match the list above)',
      type: 'string',
    },
    // Full-width tab panel → image-capable toolbar.
    {
      name: 'children',
      label: 'Content',
      type: 'rich-text',
      overrides: { toolbar: [...NESTED_WITH_IMAGE] },
    },
  ],
};

const Step: Template = {
  name: 'Step',
  label: 'Step',
  fields: [
    // A step is full-width prose → image-capable toolbar.
    {
      name: 'children',
      label: 'Content',
      type: 'rich-text',
      overrides: { toolbar: [...NESTED_WITH_IMAGE] },
    },
  ],
};

const Accordion: Template = {
  name: 'Accordion',
  label: 'Accordion',
  fields: [
    { name: 'title', label: 'Title', type: 'string' },
    // Accordion panel is full-width prose → image-capable toolbar.
    {
      name: 'children',
      label: 'Content',
      type: 'rich-text',
      overrides: { toolbar: [...NESTED_WITH_IMAGE] },
    },
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
    // File tree, not prose → embed-only toolbar.
    {
      name: 'children',
      label: 'Files',
      type: 'rich-text',
      templates: [FileItem],
      overrides: { toolbar: [...EMBED_ONLY] },
    },
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
// Deferred: `icon` (a React node / JSX, which a flat field can't represent).
// `title` rich-text is a later step.
const Card: Template = {
  name: 'Card',
  label: 'Card',
  fields: [
    {
      name: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      // `Template` has no description field, so surface the layout note on the
      // first field the editor sees: a lone Card spans the full content width;
      // wrap several Cards in a `Cards` grid for the side-by-side tile layout.
      description: 'A single Card spans the full width. Use a Cards grid for a side-by-side layout.',
    },
    { name: 'description', label: 'Description', type: 'string' },
    { name: 'href', label: 'Link (href)', type: 'string' },
    { name: 'external', label: 'Open link in new tab', type: 'boolean' },
    // Fumadocs' <Card> renders its children under the title, so this round-trips
    // losslessly. Full-width box → image-capable toolbar.
    {
      name: 'children',
      label: 'Body content',
      type: 'rich-text',
      description: 'Optional rich content shown under the title',
      overrides: { toolbar: [...NESTED_WITH_IMAGE] },
    },
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
      // The 5 REAL fumadocs-ui CalloutType values, each with a plain-English
      // label. 'warn' is dropped: it's only a runtime alias of 'warning', so
      // offering both just confuses the editor.
      options: [
        { value: 'info', label: 'Info (blue)' },
        { value: 'warning', label: 'Warning (yellow)' },
        { value: 'error', label: 'Error (red)' },
        { value: 'success', label: 'Success (green)' },
        { value: 'idea', label: 'Idea / Tip (lightbulb)' },
      ],
      ui: { component: 'select' },
    },
    // Callout is a narrow coloured box → no-image toolbar.
    {
      name: 'children',
      label: 'Content',
      type: 'rich-text',
      overrides: { toolbar: [...NESTED_NO_IMAGE] },
    },
  ],
};

const Cards: Template = {
  name: 'Cards',
  label: 'Cards',
  // A responsive grid of cards. Reuses the single `Card` template above as its
  // only nested block (DRY) — editing a card is identical inside or outside Cards.
  // Block container → embed-FIRST, no-image toolbar (a direct image breaks the grid).
  fields: [
    {
      name: 'children',
      label: 'Cards',
      type: 'rich-text',
      templates: [Card],
      overrides: { toolbar: [...NESTED_NO_IMAGE] },
    },
  ],
};

const Tabs: Template = {
  name: 'Tabs',
  label: 'Tabs',
  fields: [
    // Fumadocs binds the Tabs by position: the Nth label in this list names the
    // Nth Tab below. So this list and the Tab blocks must stay the same length
    // and in the same order, and each label must match its Tab's "Label" field.
    {
      name: 'items',
      label: 'Tab labels (must match each Tab\'s label below, in order)',
      type: 'string',
      list: true,
      description:
        'One entry per tab, in order. Each must match the "Label" of the matching Tab block below — the labels here drive the tab buttons; the Tab blocks hold the content.',
    },
    // Block container → embed-FIRST, no-image toolbar (a direct image breaks the grid).
    {
      name: 'children',
      label: 'Tabs',
      type: 'rich-text',
      templates: [Tab],
      overrides: { toolbar: [...NESTED_NO_IMAGE] },
    },
  ],
};

const Steps: Template = {
  name: 'Steps',
  label: 'Steps',
  // Block container → embed-FIRST, no-image toolbar (a direct image breaks the grid).
  fields: [
    {
      name: 'children',
      label: 'Steps',
      type: 'rich-text',
      templates: [Step],
      overrides: { toolbar: [...NESTED_NO_IMAGE] },
    },
  ],
};

const Accordions: Template = {
  name: 'Accordions',
  label: 'Accordions',
  fields: [
    {
      // Required by Fumadocs/Radix. WITHOUT this field, parsing
      // <Accordions type="…"> fails with "Unable to parse rich-text". This only
      // sets the open/close behaviour — add as many Accordion items as you like.
      name: 'type',
      label: 'Open behaviour',
      type: 'string',
      description:
        'How many panels can be open at once. Does NOT limit how many items you can add.',
      options: [
        { value: 'single', label: 'One at a time (opening one closes others)' },
        { value: 'multiple', label: 'Allow several open at once' },
      ],
      ui: { component: 'select' },
    },
    // Block container → embed-FIRST, no-image toolbar (a direct image breaks the grid).
    {
      name: 'children',
      label: 'Accordions',
      type: 'rich-text',
      templates: [Accordion],
      overrides: { toolbar: [...NESTED_NO_IMAGE] },
    },
  ],
};

const Files: Template = {
  name: 'Files',
  label: 'Files',
  // File tree, not prose → embed-only toolbar.
  fields: [
    {
      name: 'children',
      label: 'Files',
      type: 'rich-text',
      templates: [FileItem, Folder],
      overrides: { toolbar: [...EMBED_ONLY] },
    },
  ],
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
// A site-wide notice bar that wraps its content. A truthy `id` turns the banner
// dismissable: fumadocs-ui only renders the close button when `id` is set, and
// remembers the dismissed state per visitor under that key (there is NO separate
// `dismissable` prop). `variant` uses the component's own BannerVariant union
// ('normal' | 'rainbow'). `className` is a passthrough for custom Tailwind/CSS
// colours. The wrapped content maps to a `children` rich-text field. height /
// rainbowColors / changeLayout are advanced styling props, omitted to keep the
// form minimal.
const Banner: Template = {
  name: 'Banner',
  label: 'Banner',
  fields: [
    {
      name: 'variant',
      label: 'Variant',
      type: 'string',
      // BannerVariant union from fumadocs-ui banner.tsx.
      options: ['normal', 'rainbow'],
    },
    {
      name: 'id',
      label: 'Make dismissable (memory key)',
      type: 'string',
      description:
        'Provide a short, STABLE id (e.g. "summer-sale-2026") to show a dismiss button and remember the choice per visitor. Leave empty for a non-dismissable banner. Keep it the same once published — changing it makes a dismissed banner reappear.',
    },
    {
      name: 'className',
      label: 'Custom CSS classes (advanced)',
      type: 'string',
      description: 'Tailwind/CSS classes for custom colors, e.g. "bg-purple-600 text-white".',
    },
    // Banner is a narrow notice bar → no-image toolbar.
    {
      name: 'children',
      label: 'Content',
      type: 'rich-text',
      overrides: { toolbar: [...NESTED_NO_IMAGE] },
    },
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
