import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve('out');
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
  return nested.flat();
}
const files = (await walk(root)).filter(path => !path.endsWith('/sw.js') && !path.endsWith('.map')).sort();
const hash = createHash('sha256');
let bytes = 0;
for (const path of files) {
  const content = await readFile(path);
  hash.update(relative(root, path)); hash.update(content); bytes += content.byteLength;
}
const version = hash.digest('hex').slice(0, 16);
const urls = ['/', ...files.map(path => '/' + relative(root, path).split('\\').join('/'))];
const worker = `/* Generated from the complete static export. No runtime CDN or API. */
const CACHE = 'scan-organize-static-${version}';
const ASSETS = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  // Do not skipWaiting: keep an already-open app and its lazy chunks on one version.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('scan-organize-static-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const match = await cache.match(event.request, { ignoreSearch: true });
    if (match) return match;
    try { return await fetch(event.request); }
    catch {
      if (event.request.mode === 'navigate') return (await cache.match('/')) || Response.error();
      return Response.error();
    }
  })());
});
`;
await writeFile(join(root, 'sw.js'), worker);
console.log(`Offline bundle: ${urls.length} local files, ${(bytes / 1024 / 1024).toFixed(2)} MB. Cache ${version}.`);
