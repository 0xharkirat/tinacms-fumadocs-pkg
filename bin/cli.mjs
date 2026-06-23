#!/usr/bin/env node
// tinacms-fumadocs-pkg init
// ---------------------------------------------------------------------------
// One command to add TinaCMS contextual editing to an existing Fumadocs
// (Next.js App Router) site. It installs the adapter + its peer deps, writes
// the two Fumadocs-specific files (the wired docs page + the keystroke-live
// island route), and patches everything else it can reach safely: next.config,
// tsconfig, the tina/config.ts collection, the getMDXComponents map, and the
// dev script. Anything it can't edit safely it prints for you to paste. Zero
// runtime deps so it runs straight from `npx github:…` with no build step.
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..'); // adapter package root, templates/ lives here
const CWD = process.cwd(); // the user's project

const ADAPTER = 'tinacms-fumadocs-pkg';
const ADAPTER_SPEC = 'github:0xharkirat/tinacms-fumadocs-pkg';
// Peer deps the adapter needs but create-fumadocs-app / `tinacms init` do NOT
// install (singletons + version-coupled libs, see README "Why peer deps").
const PEERS = ['@tinacms/bridge@^0.3.0', '@tinacms/mdx@^2', '@mdx-js/mdx@^3'];

// The docs collection we inject into tina/config.ts (or print as a fallback).
// Indented to sit inside `schema.collections: [ … ]`. Backticks / ${…} / the
// regex dot are escaped so this template literal emits literal TS source.
const DOCS_COLLECTION = `      {
        name: 'docs',
        label: 'Docs',
        path: 'content/docs',
        format: 'mdx',
        ui: {
          // new docs -> lowercase kebab-case filename (and route) from the title
          filename: {
            slugify: (values) =>
              String(values?.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled',
          },
          router: ({ document }) => {
            const slug = document._sys.relativePath.replace(/\\.mdx?$/, '');
            return slug === 'index' ? '/docs' : \`/docs/\${slug}\`;
          },
        },
        fields: [
          { type: 'string', name: 'title', label: 'Title', isTitle: true, required: true },
          { type: 'rich-text', name: 'body', label: 'Body', isBody: true, templates: [...fumadocsTemplates] },
        ],
      },`;

// ── tiny logger ────────────────────────────────────────────────────────────
const step = (m) => console.log(`\n\x1b[1m• ${m}\x1b[0m`);
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const rel = (p) => p.replace(`${CWD}/`, '');

// ── arg parse ──────────────────────────────────────────────────────────────
const cmd = process.argv[2];
if (cmd !== 'init') {
  console.log('Usage: tinacms-fumadocs-pkg init');
  process.exit(cmd ? 1 : 0);
}

console.log('\n\x1b[1mtinacms-fumadocs-pkg · init\x1b[0m');

// ── preflight ──────────────────────────────────────────────────────────────
const pkgJsonPath = join(CWD, 'package.json');
if (!existsSync(pkgJsonPath)) {
  console.error(`\nNo package.json in ${CWD}, run this inside your Fumadocs project.`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

const pm = existsSync(join(CWD, 'pnpm-lock.yaml'))
  ? 'pnpm'
  : existsSync(join(CWD, 'yarn.lock'))
    ? 'yarn'
    : existsSync(join(CWD, 'bun.lockb')) || existsSync(join(CWD, 'bun.lock'))
      ? 'bun'
      : 'npm';

// src/app vs app, also decides whether the generated tina client needs the
// @tina/* alias (it lives at root tina/, but @/ points at src/).
const srcDir = existsSync(join(CWD, 'src', 'app'));
const appDir = srcDir ? join(CWD, 'src', 'app') : join(CWD, 'app');
if (!existsSync(appDir)) {
  console.error('\nNo app/ or src/app/, this needs a Next.js App Router project.');
  process.exit(1);
}

if (!allDeps['fumadocs-core'])
  warn('fumadocs-core not found, is this a Fumadocs site? Continuing anyway.');
if (!allDeps['tinacms'])
  warn('tinacms not found, run `pnpm dlx @tinacms/cli init` first for the Tina basics.');

console.log(`  package manager: ${pm}   app dir: ${rel(appDir)}/`);

// ── 1. install adapter + missing peers ─────────────────────────────────────
step('Installing the adapter + peer deps');
const specName = (s) => (s.lastIndexOf('@') > 0 ? s.slice(0, s.lastIndexOf('@')) : s);
const toInstall = [];
if (!allDeps[ADAPTER]) toInstall.push(ADAPTER_SPEC);
for (const p of PEERS) if (!allDeps[specName(p)]) toInstall.push(p);

if (toInstall.length === 0) {
  ok('all deps already present');
} else {
  // npm enforces peer deps strictly; fumadocs-core (react-router 7) vs tinacms
  // (react-router 6) ERESOLVEs, so the npm path needs --legacy-peer-deps.
  const addCmd = {
    pnpm: 'pnpm add',
    npm: 'npm install --legacy-peer-deps',
    yarn: 'yarn add',
    bun: 'bun add',
  }[pm];
  try {
    execSync(`${addCmd} ${toInstall.join(' ')}`, { cwd: CWD, stdio: 'inherit' });
    ok(`installed ${toInstall.length} package(s)`);
  } catch {
    warn(`install failed, run it yourself:  ${addCmd} ${toInstall.join(' ')}`);
  }
}

// ── template helpers ───────────────────────────────────────────────────────
function readTemplate(name) {
  let t = readFileSync(join(PKG_ROOT, 'templates', name), 'utf8');
  // src-dir projects alias the root tina/ client as @tina/* (not @/, that's src/).
  if (srcDir) t = t.replace(/@\/tina\//g, '@tina/');
  return t;
}
// backup:true  -> back up an existing file to .orig, then overwrite
// backup:false -> skip if the file already exists (don't clobber)
function writeFile(templateName, destPath, { backup = false, wiredMarker } = {}) {
  if (existsSync(destPath)) {
    const cur = readFileSync(destPath, 'utf8');
    if (wiredMarker && cur.includes(wiredMarker)) {
      ok(`${rel(destPath)} already wired, skipped`);
      return;
    }
    if (!backup) {
      ok(`${rel(destPath)} exists, skipped`);
      return;
    }
    const bak = `${destPath}.orig`;
    if (!existsSync(bak)) copyFileSync(destPath, bak);
    warn(`backed up your file to ${rel(bak)}`);
  }
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, readTemplate(templateName));
  ok(`wrote ${rel(destPath)}`);
}

// ── 2. island route (new file) ─────────────────────────────────────────────
step('Writing the keystroke-live island route');
writeFile('route.ts', join(appDir, 'api', 'tina-island', 'docs', '[[...slug]]', 'route.ts'));

// ── 3. docs page (wire it; back up the original) ───────────────────────────
step('Wiring the docs page');
writeFile('page.tsx', join(appDir, 'docs', '[[...slug]]', 'page.tsx'), {
  backup: true,
  wiredMarker: 'tinacms-fumadocs-pkg:wired',
});

// ── 4. next.config transpilePackages ───────────────────────────────────────
// The adapter ships TS (no dist), so a missing transpilePackages entry is a hard
// build failure. Track whether the config actually gets wired so the final
// summary never claims success when it could not patch.
step('Patching next.config (transpilePackages)');
let configWired = false;
(() => {
  const f = ['next.config.mjs', 'next.config.js', 'next.config.ts']
    .map((x) => join(CWD, x))
    .find(existsSync);
  if (!f) return warn('no next.config found. Add: transpilePackages: ["tinacms-fumadocs-pkg"]');
  const src = readFileSync(f, 'utf8');
  if (src.includes("'tinacms-fumadocs-pkg'") || src.includes('"tinacms-fumadocs-pkg"')) {
    configWired = true;
    return ok(`${rel(f)} already lists the adapter`);
  }
  if (/transpilePackages\s*:/.test(src))
    return warn(`add "tinacms-fumadocs-pkg" to the existing transpilePackages in ${rel(f)}`);
  // Inject after a config-object opening we recognise: const config / nextConfig
  // (named, any position), an inline `export default {`, or a wrapped
  // `export default withMDX({`. A non-standard config variable name falls through
  // to the manual-step warning below: safer than a catch-all `const x = {` that
  // could match an unrelated object earlier in the file.
  const opener = [
    /\bconst\s+(?:config|nextConfig)\b[^=]*=\s*\{/,
    /\bexport\s+default\s*\{/,
    /\bexport\s+default\s+\w+\(\s*\{/,
  ].find((re) => re.test(src));
  if (!opener)
    return warn(`could not auto-edit ${rel(f)}. Add: transpilePackages: ["tinacms-fumadocs-pkg"]`);
  // Function replacer so a `$` in the matched text is never read as a pattern.
  writeFileSync(f, src.replace(opener, (full) => `${full}\n  transpilePackages: ['tinacms-fumadocs-pkg'],`));
  configWired = true;
  ok(`added transpilePackages to ${rel(f)}`);
})();

// ── 5. tsconfig @tina/* alias (src-dir only) ───────────────────────────────
if (srcDir) {
  step('Adding the @tina/* tsconfig alias (src-dir project)');
  const f = join(CWD, 'tsconfig.json');
  if (!existsSync(f)) {
    warn('no tsconfig.json');
  } else {
    try {
      const json = JSON.parse(readFileSync(f, 'utf8'));
      json.compilerOptions ??= {};
      json.compilerOptions.paths ??= {};
      if (json.compilerOptions.paths['@tina/*']) {
        ok('@tina/* alias already present');
      } else {
        json.compilerOptions.paths['@tina/*'] = ['./tina/*'];
        writeFileSync(f, `${JSON.stringify(json, null, 2)}\n`);
        ok('added @tina/* alias to tsconfig.json');
      }
    } catch {
      warn('tsconfig has comments, add manually under compilerOptions.paths: "@tina/*": ["./tina/*"]');
    }
  }
}

// ── 6. gitignore the Tina admin build (a tinacms build/dev output) ─────────
step('Gitignoring the Tina admin build (public/admin)');
(() => {
  const f = join(CWD, '.gitignore');
  const entry = 'public/admin';
  const src = existsSync(f) ? readFileSync(f, 'utf8') : '';
  // tolerate a leading and/or trailing slash on an existing entry
  const has = src.split(/\r?\n/).some((l) => {
    const t = l.trim().replace(/\/+$/, '');
    return t === entry || t === `/${entry}`;
  });
  if (has) return ok('.gitignore already ignores public/admin');
  writeFileSync(
    f,
    `${src.replace(/\s*$/, '')}\n\n# TinaCMS admin build (regenerated by tinacms build/dev)\npublic/admin\n`,
  );
  ok('added public/admin to .gitignore');
})();

// ── 7. tina/config.ts, the docs collection ────────────────────────────────
// Replace Tina's sample collection with a Fumadocs `docs` collection. The
// sample tina-init config is deterministic, so we add the import and rewrite
// the contents of `collections: [ … ]` by bracket-matching. Anything unexpected
// falls back to printing the block for a manual paste.
step('Wiring the docs collection (tina/config.ts)');
let collectionWired = false;
try {
  const f = join(CWD, 'tina', 'config.ts');
  if (!existsSync(f)) {
    warn('no tina/config.ts, run `pnpm dlx @tinacms/cli init` first, then re-run');
  } else {
    let src = readFileSync(f, 'utf8');
    if (src.includes('fumadocsTemplates') || /["']content\/docs["']/.test(src)) {
      collectionWired = true;
      ok('tina/config.ts already has the docs collection');
    } else {
      const importLine = `import { fumadocsTemplates } from '${ADAPTER}/templates';\n`;
      src = /from\s+["']tinacms["'];?\n/.test(src)
        ? src.replace(/(from\s+["']tinacms["'];?\n)/, `$1${importLine}`)
        : importLine + src;
      // find `collections: [` and bracket-match to its closing `]`
      const ci = src.indexOf('collections');
      const open = ci >= 0 ? src.indexOf('[', ci) : -1;
      let depth = 0;
      let close = -1;
      for (let i = open; open >= 0 && i < src.length; i++) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']' && --depth === 0) {
          close = i;
          break;
        }
      }
      if (close < 0) {
        warn('could not find the collections array, paste the docs collection below into tina/config.ts');
      } else {
        src = `${src.slice(0, open + 1)}\n${DOCS_COLLECTION}\n    ${src.slice(close)}`;
        writeFileSync(f, src);
        collectionWired = true;
        ok('added the docs collection (replaced the sample) in tina/config.ts');
      }
    }
  }
} catch {
  warn('could not edit tina/config.ts, paste the docs collection below');
}

// ── 8. components/mdx.tsx, make every Embed component renderable ──────────
// Fumadocs' default map omits Steps / Accordions / Files; spread our matching
// components into getMDXComponents so inserted blocks render on the page.
step('Wiring the render components (getMDXComponents)');
let componentsWired = false;
try {
  const f = [
    join(CWD, 'components', 'mdx.tsx'),
    join(CWD, 'src', 'components', 'mdx.tsx'),
    join(CWD, 'mdx-components.tsx'),
    join(CWD, 'src', 'mdx-components.tsx'),
  ].find(existsSync);
  if (!f) {
    warn('no components/mdx.tsx, spread ...fumadocsComponents into getMDXComponents (snippet below)');
  } else {
    let src = readFileSync(f, 'utf8');
    if (src.includes('fumadocsComponents')) {
      componentsWired = true;
      ok(`${rel(f)} already spreads fumadocsComponents`);
    } else if (!/\.\.\.defaultMdxComponents,/.test(src)) {
      warn(`couldn't find ...defaultMdxComponents in ${rel(f)}, add ...fumadocsComponents (snippet below)`);
    } else {
      const importLine = `import { fumadocsComponents } from '${ADAPTER}/components';\n`;
      src = /from\s+["']fumadocs-ui\/mdx["'];?\n/.test(src)
        ? src.replace(/(from\s+["']fumadocs-ui\/mdx["'];?\n)/, `$1${importLine}`)
        : importLine + src;
      src = src.replace(/(\.\.\.defaultMdxComponents,)/, '$1\n    ...fumadocsComponents,');
      writeFileSync(f, src);
      componentsWired = true;
      ok(`spread ...fumadocsComponents into ${rel(f)}`);
    }
  }
} catch {
  warn('could not edit components/mdx.tsx, add ...fumadocsComponents (snippet below)');
}

// ── 9. package.json, wrap the dev script with tinacms dev ──────────────────
step('Wrapping the dev script (tinacms dev)');
(() => {
  // re-read: step 1 (install) rewrote package.json with the new deps
  const fresh = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const dev = fresh.scripts?.dev || '';
  if (/tinacms\s+dev/.test(dev)) return ok('dev script already runs tinacms dev');
  const inner = dev || 'next dev';
  fresh.scripts ??= {};
  fresh.scripts.dev = `tinacms dev -c "${inner}"`;
  writeFileSync(pkgJsonPath, `${JSON.stringify(fresh, null, 2)}\n`);
  ok(`dev script -> tinacms dev -c "${inner}"`);
})();

// ── done ───────────────────────────────────────────────────────────────────
const fullyWired = configWired && collectionWired && componentsWired;
console.log(`\n\x1b[1m${fullyWired ? '✓ Wired.' : '✓ Almost wired, finish the ! items below.'}\x1b[0m`);

if (!configWired) {
  console.log("\n  next.config, add:  transpilePackages: ['tinacms-fumadocs-pkg']");
  console.log('  (the adapter ships TypeScript, so it MUST be transpiled or the build fails)');
}
if (!collectionWired) {
  console.log('\n  tina/config.ts, add the import at the top:');
  console.log(`    import { fumadocsTemplates } from '${ADAPTER}/templates';`);
  console.log('  and put this collection inside schema.collections (replace the sample):');
  console.log(DOCS_COLLECTION);
}
if (!componentsWired) {
  console.log('\n  components/mdx.tsx, spread the render components:');
  console.log(`    import { fumadocsComponents } from '${ADAPTER}/components';`);
  console.log('    return { ...defaultMdxComponents, ...fumadocsComponents, ...components };');
}

console.log(`\n  Then:  \x1b[1m${pm} run dev\x1b[0m   →   http://localhost:3000/admin   → click a doc to edit\n`);
