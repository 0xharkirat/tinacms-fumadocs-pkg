// Adds `data-tina-field` click-to-edit markers to a Fumadocs MDX components map
// WITHOUT replacing Fumadocs' components. We wrap whatever component Fumadocs
// already provides for a tag and forward every prop, only layering on the
// attribute. Fumadocs' renderer, styling, and behaviour are untouched.
//
// The reliable marker is the coarse body-wrapper one applied in your page
// (a `data-tina-field` on <DocsBody>). This helper additionally tags the body's
// paragraphs so clicking anywhere in the prose focuses the `body` field.

import React from 'react';
import type { MDXComponents } from 'mdx/types';

export function withTinaMarkers(
  components: MDXComponents,
  bodyFieldName: string,
): MDXComponents {
  const augmented: MDXComponents = { ...components };
  const BaseP = (components.p ?? 'p') as React.ElementType;
  augmented.p = function TinaP(props: React.ComponentProps<'p'>) {
    return React.createElement(BaseP, {
      ...props,
      'data-tina-field': bodyFieldName,
    });
  };
  return augmented;
}
