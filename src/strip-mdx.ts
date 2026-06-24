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
// SAFE-LITERAL ALLOWLIST (was a known limitation): an expression-valued JSX prop
// is KEPT only when its value is a pure compile-time literal — a string/number/
// boolean/null `Literal`, an `ArrayExpression`/`ObjectExpression` built entirely
// from such literals (recursively), or a unary +/- on a numeric literal. This is
// what lets `<Tabs items={['a','b']}/>` render its tab list live while STILL
// stripping anything that can read state or run code (`{process.env.X}`,
// `{someVar}`, `{foo()}`, template literals, JSX, …). The check walks the parsed
// estree (`attr.value.data.estree`), so an attacker cannot smuggle an identifier
// or member access inside an array/object — every leaf must be a literal. Spread
// props (`{...x}`) and all node-level `{…}`/import-export remain unconditionally
// stripped. See `isAttributeSafe` / `isSafeLiteralExpression` below.

// Node types @mdx-js/mdx (and Fumadocs' runtime, same parser) turn into
// evaluated server/client JS. We remove them from the mdast.
export const UNSAFE_MDX_NODES = new Set([
  'mdxFlowExpression', // {expr} as a block
  'mdxTextExpression', // {expr} inline inside text
  'mdxjsEsm', // import / export
]);

// ── safe-literal predicate ────────────────────────────────────────────────────
// Minimal ESTree node shapes we care about (estree types aren't a runtime dep).
interface EsNode {
  type: string;
  [key: string]: unknown;
}

/**
 * Is this ESTree expression a pure compile-time literal (no identifiers, member
 * access, calls, templates, JSX, spreads)? Recurses into arrays/objects so EVERY
 * leaf must itself be safe. This is the allowlist that distinguishes a benign
 * `['a','b']` / `{a:1}` from anything that could read state or execute code.
 */
function isSafeLiteralExpression(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as EsNode;
  switch (n.type) {
    // Primitive literal: "x", 1, true, null. (RegExpLiteral also has type
    // 'Literal' but carries a `regex` field — reject those to stay conservative.)
    case 'Literal':
      return !('regex' in n);
    // Unary +/- on a numeric literal: `{-2}`, `{+1}`. Disallow other operators
    // (`!`, `typeof`, `void`, `delete`) and non-literal arguments.
    case 'UnaryExpression':
      return (
        (n.operator === '-' || n.operator === '+') &&
        isSafeLiteralExpression(n.argument)
      );
    // Array of safe values: `['a', 1, ['b']]`. A hole (sparse array) is null.
    case 'ArrayExpression':
      return (n.elements as unknown[]).every(
        (el) => el === null || isSafeLiteralExpression(el),
      );
    // Object of safe values with static keys: `{a: 1, "b": [true]}`. No spreads,
    // no computed keys, no shorthand/identifier keys that could read scope.
    case 'ObjectExpression':
      return (n.properties as EsNode[]).every((p) => {
        if (!p || p.type !== 'Property') return false; // SpreadElement → unsafe
        if (p.computed) return false; // `{[x]: …}` → unsafe
        const key = p.key as EsNode | undefined;
        const keyOk =
          !!key &&
          (key.type === 'Identifier' || // `{a: …}` — a static name, not a read
            key.type === 'Literal'); // `{"a": …}` / `{1: …}`
        return keyOk && isSafeLiteralExpression(p.value);
      });
    default:
      // Identifier, MemberExpression, CallExpression, TemplateLiteral,
      // TaggedTemplateExpression, arrow/function expressions, JSXElement,
      // SpreadElement, etc. → never safe.
      return false;
  }
}

/**
 * Decide whether a single JSX attribute survives the strip.
 *   - spread attribute (`{...x}`)            → STRIP (can splat arbitrary props)
 *   - expression value (`foo={…}`)           → KEEP iff the expression is a pure
 *                                               literal; STRIP otherwise
 *   - everything else (`foo="bar"`, boolean) → KEEP (no expression evaluates)
 */
function isAttributeSafe(attr: unknown): boolean {
  if (!attr || typeof attr !== 'object') return true;
  const at = attr as {
    type?: string;
    value?: { type?: string; data?: { estree?: EsNode } } | null;
  };
  if (at.type === 'mdxJsxExpressionAttribute') return false; // spread → strip
  if (at.value?.type !== 'mdxJsxAttributeValueExpression') return true; // literal string / boolean attr
  // Expression-valued: parse tree is a Program; the value is its sole statement's
  // expression. If anything is missing/odd, fail closed (strip).
  const expr = at.value.data?.estree?.body as EsNode[] | undefined;
  const statement = expr?.[0];
  if (!statement || statement.type !== 'ExpressionStatement') return false;
  return isSafeLiteralExpression(statement.expression);
}

/**
 * remark plugin: remove MDX expression / ESM nodes and UNSAFE expression-valued
 * JSX attributes anywhere in the tree. Safe literal props (e.g.
 * `<Tabs items={['a','b']}/>`) are preserved; `{...spread}` and non-literal
 * expressions (`{process.env.X}`, `{someVar}`, `{foo()}`) are stripped.
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
  // JSX element props evaluate too — drop spread + non-literal expression
  // attributes, but KEEP safe compile-time literals (see isAttributeSafe).
  if (Array.isArray(n.attributes)) {
    n.attributes = n.attributes.filter(isAttributeSafe);
  }
}
