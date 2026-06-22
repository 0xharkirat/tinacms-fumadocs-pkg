// Tina `templates` for stock Fumadocs UI components, so they round-trip as
// editable blocks in the admin instead of opaque text. Spread the top-level
// set into your body rich-text field's `templates`:
//
//   import { fumadocsTemplates } from 'fumadocs-tinacms/templates';
//   // ...
//   { type: 'rich-text', name: 'body', isBody: true,
//     templates: [...fumadocsTemplates, ...yourCustomTemplates] }
//
// Import from the `/templates` subpath (not the package root) inside
// tina/config.ts, so the Tina config build never pulls in the client bridge.
//
// `template.name` must match the JSX component name Fumadocs renders. A
// component's child MDX content maps to a `children` rich-text field; nested
// components (Card inside Cards, etc.) are declared as that field's templates.

import type { Template } from 'tinacms';

// --- nested children (only used inside a parent's `children` field) ---

const Card: Template = {
  name: 'Card',
  label: 'Card',
  fields: [
    { name: 'title', label: 'Title', type: 'string' },
    { name: 'description', label: 'Description', type: 'string' },
    { name: 'href', label: 'Href', type: 'string' },
  ],
};

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
    // Note: nested folders aren't self-referenced (Tina templates can't
    // recurse inline); only files are editable one level deep for now.
    { name: 'children', label: 'Files', type: 'rich-text', templates: [FileItem] },
  ],
};

// --- top-level components (usable directly in the doc body) ---

const Callout: Template = {
  name: 'Callout',
  label: 'Callout',
  fields: [
    { name: 'title', label: 'Title', type: 'string' },
    {
      name: 'type',
      label: 'Type',
      type: 'string',
      // Verify option values against your installed fumadocs-ui version.
      options: ['info', 'warn', 'error', 'success'],
    },
    { name: 'children', label: 'Content', type: 'rich-text' },
  ],
};

const Cards: Template = {
  name: 'Cards',
  label: 'Cards',
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
  fields: [{ name: 'children', label: 'Accordions', type: 'rich-text', templates: [Accordion] }],
};

const Files: Template = {
  name: 'Files',
  label: 'Files',
  fields: [{ name: 'children', label: 'Files', type: 'rich-text', templates: [FileItem, Folder] }],
};

/**
 * Top-level Tina templates for stock Fumadocs UI components. Nested components
 * (Card, Tab, Step, Accordion, File, Folder) are reachable inside their parents.
 *
 * Not included (round-trip as plain text, not visually editable — Jack's list):
 * TypeTable (nested JSON prop), components with icon/render/callback props.
 */
export const fumadocsTemplates: Template[] = [
  Callout,
  Cards,
  Tabs,
  Steps,
  Accordions,
  Files,
];
