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
const cleanedHead = head
  .split('\n')
  .filter((line) => !/rel="(icon|apple-touch-icon|manifest)"/.test(line))
  .join('\n');

writeFileSync(outPath, cleanedHead + '\n' + body + '\n');
console.log(`build-artifact: wrote ${outPath}`);
