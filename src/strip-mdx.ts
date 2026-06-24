// SECURITY: strip evaluated MDX from the UNTRUSTED preview compile. Used by the
// CLIENT live-body compiler (client-compile.ts → @fumadocs/mdx-remote). Kept as
// its own module so the security rule lives in exactly one place (DRY).
//
// NO 'server-only' here — this module runs in the client bundle. It is pure mdast
// surgery (no Node APIs, no React), so it is environment-safe.
//
// Why strip at all: the live-body compiler EVALUATES MDX `{…}` expressions and
// import/export as JS, fed the editor's UNTRUSTED overlay, so attacker text like
// `{process.env.X}` (in body text OR a JSX prop) would leak env / run code. We
// remove these nodes from the PARSED mdast (after remark-mdx has parsed the
// string) so every entry path is covered — text, inline, and props — which an
// input-AST check could not do. `{…}` is never legitimate docs-body content, so
// removal is safe, and only the PREVIEW compile is affected — production still
// uses Fumadocs' own renderer.
//
// KNOWN LIMITATION: this strips ALL expression-valued JSX props, including safe
// literals like `<Tabs items={['a','b']}/>`. So a Tabs/Steps that derives its UI
// from an array prop renders EMPTY in the live preview (it is still correct on the
// published page, which never strips). Telling a safe `['a','b']` literal apart
// from `{process.env.X}` needs full estree analysis, which we deliberately avoid
// for a simple, provably-safe blanket strip. Live array-prop editing is future
// work (an allowlist for literal arrays/objects of primitives).

// Node types @mdx-js/mdx (and Fumadocs' runtime, same parser) turn into
// evaluated server/client JS. We remove them from the mdast.
export const UNSAFE_MDX_NODES = new Set([
  'mdxFlowExpression', // {expr} as a block
  'mdxTextExpression', // {expr} inline inside text
  'mdxjsEsm', // import / export
]);

/**
 * remark plugin: remove MDX expression / ESM nodes and expression-valued JSX
 * attributes (`<Tabs items={…}/>`, `{...spread}`) anywhere in the tree.
 *
 * Pass it as a remark plugin to either compiler:
 *   compile(src, { remarkPlugins: [..., remarkStripMdxExpressions] })   // @mdx-js/mdx
 *   createCompiler({ remarkPlugins: [remarkStripMdxExpressions] })      // @fumadocs/mdx-remote
 */
export function remarkStripMdxExpressions() {
  return (tree: unknown) => {
    stripMdxExpressions(tree);
  };
}

/** Recursively drop unsafe nodes + expression/spread JSX attributes in place. */
export function stripMdxExpressions(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { children?: unknown[]; attributes?: unknown[] };
  if (Array.isArray(n.children)) {
    n.children = n.children.filter(
      (c) =>
        !(
          c &&
          typeof c === 'object' &&
          UNSAFE_MDX_NODES.has((c as { type?: string }).type ?? '')
        ),
    );
    n.children.forEach(stripMdxExpressions);
  }
  // JSX element props evaluate too — drop expression / spread attributes.
  if (Array.isArray(n.attributes)) {
    n.attributes = n.attributes.filter((a) => {
      if (!a || typeof a !== 'object') return true;
      const at = a as { type?: string; value?: { type?: string } | null };
      return (
        at.type !== 'mdxJsxExpressionAttribute' &&
        at.value?.type !== 'mdxJsxAttributeValueExpression'
      );
    });
  }
}
