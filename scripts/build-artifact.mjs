// Post-processes the single-file `vite build --mode artifact` output into a
// bare <head>+<body> fragment suitable for Claude's Artifact tool, which
// wraps published content in its own `<!doctype html>...<head>...<body>`
// skeleton — a full `<html>` document would nest illegally inside that.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const srcPath = resolve('dist-artifact/index.html');
const outPath = resolve('dist-artifact/artifact.html');

const html = readFileSync(srcPath, 'utf8');

function extract(tag) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!match) throw new Error(`build-artifact: could not find <${tag}> in ${srcPath}`);
  return match[1];
}

const head = extract('head');
const body = extract('body');

// Icon/manifest links aren't meaningful inside the Artifact preview frame —
// the Artifact tool's own `favicon` param covers the tab icon there.
//
// This strips the <link> ELEMENTS, not whole lines. It used to drop any line
// matching rel="icon", which is fine while that string only ever appears in
// markup — but the bundle is inlined into this same <head> as a handful of
// enormous lines, so the day app code set `link.rel = 'icon'` (the tab-icon
// picker), the minifier put rel="icon" inside a 26KB line of real JavaScript
// and the filter deleted the lot. The page then died on a syntax error at the
// truncation point, with a green build.
const cleanedHead = head.replace(
  /<link\b[^>]*\brel="(?:icon|apple-touch-icon|manifest)"[^>]*>/g,
  '',
);

writeFileSync(outPath, cleanedHead + '\n' + body + '\n');
console.log(`build-artifact: wrote ${outPath}`);
