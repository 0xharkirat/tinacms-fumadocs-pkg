// The RENDER half of the adapter: the Fumadocs UI components that match the
// INSERT half (`fumadocsTemplates`, the editor's Embed menu). Spread this into
// your `getMDXComponents` so anything you can insert in the editor can also
// render on the page:
//
//   import { fumadocsComponents } from 'tinacms-fumadocs-pkg/components';
//   export function getMDXComponents(components?: MDXComponents) {
//     return { ...defaultMdxComponents, ...fumadocsComponents, ...components };
//   }
//
// Why it's needed: Fumadocs' default map (`fumadocs-ui/mdx`) only ships
// Callout/Card/Cards/Tab/Tabs. Steps, Accordions and Files are separate imports,
// so inserting one of those without registering it throws at render time:
// "Expected component `Files` to be defined: you likely forgot to import…".
import { Callout } from 'fumadocs-ui/components/callout';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { File, Folder, Files } from 'fumadocs-ui/components/files';

/** One entry per component in `fumadocsTemplates`. */
export const fumadocsComponents = {
  Callout,
  Card,
  Cards,
  Tab,
  Tabs,
  Step,
  Steps,
  Accordion,
  Accordions,
  File,
  Folder,
  Files,
};
