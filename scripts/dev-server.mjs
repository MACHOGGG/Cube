/**
 * The built site plus the api/ functions, in one process.
 *
 *   node scripts/dev-server.mjs [port] [dir]
 *
 * `vercel dev` is the real thing; this exists so the multiplayer and redeem
 * flows can be driven end to end — by a browser, or by the Playwright checks
 * — without an account anywhere. It sets ALLOW_MEMORY_STORE, so rooms and
 * codes live in this process's memory and vanish with it. One process means
 * that memory really is shared, which is exactly what a deployment cannot
 * promise and why the store refuses to use it there.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

process.env.ALLOW_MEMORY_STORE = '1';

const port = Number(process.argv[2]) || 8815;
const root = process.argv[3] || 'dist';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** The api/ handlers are written against Vercel's res, which has .status(). */
function vercelify(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  return res;
}

const handlers = new Map();
async function handlerFor(name) {
  if (!handlers.has(name)) {
    try {
      handlers.set(name, (await import(`../api/${name}.js`)).default);
    } catch {
      handlers.set(name, null);
    }
  }
  return handlers.get(name);
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });

/**
 * Two known codes, so the redeem and room flows can be driven without
 * minting any. They exist only because the store is the in-memory one; a
 * deployment reaches neither this file nor that store.
 */
const { set } = await import('../api/_store.js');
await set('code:TESTMONTH', { plan: 'month' });
await set('code:TESTYEAR', { plan: 'year' });
console.log('test redeem codes: TESTMONTH (1 month), TESTYEAR (1 year)');

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
    const handler = await handlerFor(name);
    if (!handler) {
      res.writeHead(404).end('{"error":"noSuchEndpoint"}');
      return;
    }
    req.body = await readBody(req);
    await handler(req, vercelify(res));
    return;
  }

  const wanted = url.pathname === '/' ? '/index.html' : url.pathname;
  const path = join(root, normalize(wanted).replace(/^(\.\.[/\\])+/, ''));
  try {
    const file = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(file);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`serving ${root} + api/ on http://localhost:${port}`));
