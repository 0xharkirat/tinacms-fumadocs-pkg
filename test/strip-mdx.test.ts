// SECURITY BOUNDARY TEST — reads as the spec for what the live-body strip allows
// vs. removes. `stripMdxExpressions` is the single chokepoint that neutralises the
// UNTRUSTED editor overlay before the client compiler EVALUATES it as JS (see
// src/strip-mdx.ts). If an assertion here ever fails, treat it as a potential
// sandbox escape, not a flaky test.
//
// Realism: we feed the strip the SAME mdast the production compiler sees. The real
// pipeline is `@mdx-js/mdx` `compile()` with `remarkStripMdxExpressions` running
// last (src/client-compile.ts). `@mdx-js/mdx` parses via remark-mdx, which attaches
// the acorn-parsed ESTree to each JSX-attribute value at `attr.value.data.estree`
// — exactly what `isAttributeSafe` inspects. We reproduce that parse with the same
// stack (`unified().use(remarkParse).use(remarkMdx).parse(src)`); `.parse()` alone
// populates the estree (verified), so no transform/run phase is needed.

import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import {
  stripMdxExpressions,
  UNSAFE_MDX_NODES,
} from '../src/strip-mdx';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Minimal mdast node shape we walk in assertions (parser returns `any`). */
interface MdastNode {
  type: string;
  name?: string | null;
  attributes?: { type?: string; name?: string | null }[];
  children?: MdastNode[];
  [key: string]: unknown;
}

/**
 * Parse MDX into an mdast WITH the ESTree attached to JSX-attribute values, then
 * run the in-place strip. Returns the mutated tree to assert against. This is the
 * real production parse stack (remark-parse + remark-mdx), so the estree the strip
 * reads is the same acorn output `@mdx-js/mdx compile()` would produce.
 */
function parseAndStrip(src: string): MdastNode {
  const tree = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .parse(src) as unknown as MdastNode;
  stripMdxExpressions(tree); // mutates in place
  return tree;
}

/** Depth-first collect every node whose type matches (e.g. all JSX elements). */
function collect(
  node: MdastNode | undefined,
  pred: (n: MdastNode) => boolean,
  out: MdastNode[] = [],
): MdastNode[] {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const child of node.children ?? []) collect(child, pred, out);
  return out;
}

/** The first JSX element in the tree (flow or text), with its attributes. */
function firstJsxElement(tree: MdastNode): MdastNode {
  const els = collect(
    tree,
    (n) =>
      n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement',
  );
  expect(els.length, 'expected at least one JSX element').toBeGreaterThan(0);
  return els[0];
}

/** Names of the attributes that SURVIVED the strip on a given element. */
function attrNames(el: MdastNode): (string | null | undefined)[] {
  return (el.attributes ?? []).map((a) => a.name);
}

// ── KEEP: pure compile-time literals must survive ──────────────────────────────
// These props evaluate to fixed data the live preview needs to render (a tab list,
// a number, a TOC). Every leaf is a Literal, so there is nothing for an attacker to
// smuggle — keeping them is what makes the live preview faithful.

describe('KEEP — safe compile-time literal props survive', () => {
  it('array of string literals: <Tabs items={["a","b"]}/>', () => {
    const el = firstJsxElement(parseAndStrip(`<Tabs items={['a','b']}/>`));
    expect(attrNames(el)).toContain('items');
  });

  it('numeric literal: <X n={3}/>', () => {
    const el = firstJsxElement(parseAndStrip(`<X n={3}/>`));
    expect(attrNames(el)).toContain('n');
  });

  it('boolean literal: <X b={true}/>', () => {
    const el = firstJsxElement(parseAndStrip(`<X b={true}/>`));
    expect(attrNames(el)).toContain('b');
  });

  it('unary minus on numeric literal: <X k={-2}/>', () => {
    const el = firstJsxElement(parseAndStrip(`<X k={-2}/>`));
    expect(attrNames(el)).toContain('k');
  });

  it('array of object literals: <InlineTOC items={[{title,url,depth}]}/>', () => {
    const el = firstJsxElement(
      parseAndStrip(
        `<InlineTOC items={[{title:'a',url:'/a',depth:1}]}/>`,
      ),
    );
    expect(attrNames(el)).toContain('items');
  });

  it('plain string attribute (no expression): <X s="hi"/>', () => {
    const el = firstJsxElement(parseAndStrip(`<X s="hi"/>`));
    expect(attrNames(el)).toContain('s');
  });
});

// ── STRIP: anything that can read state or run code must be removed ─────────────
// Each of these, if it survived into the client compile, would be EVALUATED as JS
// against the untrusted overlay. The element itself stays; only the dangerous
// attribute is dropped (so we assert the attr name is gone, not the element).

describe('STRIP — non-literal / dangerous props are removed', () => {
  it('member access (env read): <X v={process.env.SECRET}/>', () => {
    const el = firstJsxElement(
      parseAndStrip(`<X v={process.env.SECRET}/>`),
    );
    expect(attrNames(el)).not.toContain('v');
  });

  it('bare identifier (scope read): <X v={someVar}/>', () => {
    const el = firstJsxElement(parseAndStrip(`<X v={someVar}/>`));
    expect(attrNames(el)).not.toContain('v');
  });

  it('call expression: <X v={foo()}/>', () => {
    const el = firstJsxElement(parseAndStrip(`<X v={foo()}/>`));
    expect(attrNames(el)).not.toContain('v');
  });

  it('template literal: <X v={`hi ${x}`}/>', () => {
    const el = firstJsxElement(parseAndStrip('<X v={`hi ${x}`}/>'));
    expect(attrNames(el)).not.toContain('v');
  });

  it('JSX-valued prop: <X v={<Y/>}/>', () => {
    const el = firstJsxElement(parseAndStrip(`<X v={<Y/>}/>`));
    expect(attrNames(el)).not.toContain('v');
  });

  it('spread attribute: <X {...spread}/>', () => {
    // The spread has no `name`; assert no expression-attribute survived at all.
    const el = firstJsxElement(parseAndStrip(`<X {...spread}/>`));
    const survivedExprAttr = (el.attributes ?? []).some(
      (a) => a.type === 'mdxJsxExpressionAttribute',
    );
    expect(survivedExprAttr).toBe(false);
  });

  it('computed object key (reads scope): <X v={{[k]:1}}/>', () => {
    const el = firstJsxElement(parseAndStrip(`<X v={{[k]:1}}/>`));
    expect(attrNames(el)).not.toContain('v');
  });

  it('array containing a non-literal: <X v={[someVar]}/>', () => {
    // Guards the recursion: one unsafe leaf poisons the whole array.
    const el = firstJsxElement(parseAndStrip(`<X v={[someVar]}/>`));
    expect(attrNames(el)).not.toContain('v');
  });
});

// ── STRIP: node-level expressions and import/export are always removed ──────────
// `{…}` as body content and ESM import/export are NEVER legitimate docs body, and
// they evaluate unconditionally — so they are dropped regardless of contents.

describe('STRIP — node-level {expr} and import/export are removed', () => {
  it('inline body expression {process.env.X} leaves no mdxTextExpression', () => {
    const tree = parseAndStrip(`hello {process.env.X} world`);
    const found = collect(tree, (n) => n.type === 'mdxTextExpression');
    expect(found).toHaveLength(0);
  });

  it('block body expression leaves no mdxFlowExpression', () => {
    const tree = parseAndStrip(`{process.env.X}`);
    const found = collect(tree, (n) => n.type === 'mdxFlowExpression');
    expect(found).toHaveLength(0);
  });

  it('import statement leaves no mdxjsEsm node', () => {
    const tree = parseAndStrip(`import x from 'y'\n\n# hi`);
    const found = collect(tree, (n) => n.type === 'mdxjsEsm');
    expect(found).toHaveLength(0);
  });

  it('all three unsafe node types are gone in one mixed document', () => {
    const tree = parseAndStrip(
      [
        `import secret from './secret'`, // mdxjsEsm
        ``,
        `Body text with {process.env.LEAK} inline.`, // mdxTextExpression
        ``,
        `{globalThis.window}`, // mdxFlowExpression
      ].join('\n'),
    );
    const survivors = collect(tree, (n) => UNSAFE_MDX_NODES.has(n.type));
    expect(survivors).toHaveLength(0);
  });
});

// ── sanity: the allowlist constant is what we expect ────────────────────────────

describe('UNSAFE_MDX_NODES allowlist', () => {
  it('covers exactly the three evaluated node kinds', () => {
    expect([...UNSAFE_MDX_NODES].sort()).toEqual(
      ['mdxFlowExpression', 'mdxTextExpression', 'mdxjsEsm'].sort(),
    );
  });
});
