import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectDir = dirname(fileURLToPath(import.meta.url));

const offlineServiceWorker = () => ({
  name: 'offline-service-worker',
  generateBundle(_options: unknown, bundle: Record<string, unknown>) {
    const files = Object.keys(bundle).filter((file) => file !== 'sw.js');
    const version = createHash('sha256')
      .update(files.join('|'))
      .update(readFileSync(join(projectDir, 'index.html')))
      .update(readFileSync(join(projectDir, 'public/manifest.webmanifest')))
      .update(readFileSync(join(projectDir, 'public/icon.svg')))
      .digest('hex')
      .slice(0, 16);
    const precache = ['./', './manifest.webmanifest', './icon.svg', ...files.map((file) => `./${file}`)];
    const source = `const CACHE_NAME = 'pdf-overlay-${version}';
const APP_ROOT = self.registration.scope;
const PRECACHE_URLS = ${JSON.stringify(precache)}.map((path) => new URL(path, APP_ROOT).href);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const existed = (await caches.keys()).includes(CACHE_NAME);
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    } catch (error) {
      if (!existed) await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = (await caches.keys()).filter((key) => key.startsWith('pdf-overlay-') && key !== CACHE_NAME);
    const keepPrevious = keys.at(-1);
    await Promise.all(keys.filter((key) => key !== keepPrevious).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || !requestUrl.pathname.startsWith(new URL(APP_ROOT).pathname)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) =>
      (await cache.match(APP_ROOT)) || fetch(event.request).catch(() => Response.error())));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const current = await cache.match(event.request);
    if (current) return current;
    const previous = (await caches.keys()).filter((key) => key.startsWith('pdf-overlay-') && key !== CACHE_NAME).at(-1);
    const older = previous && await (await caches.open(previous)).match(event.request);
    return older || fetch(event.request).catch(() => Response.error());
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CHECK_OFFLINE') return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const stored = await Promise.all(PRECACHE_URLS.map((url) => cache.match(url)));
      event.ports[0]?.postMessage({ ready: stored.every(Boolean), version: CACHE_NAME });
    } catch {
      event.ports[0]?.postMessage({ ready: false, version: CACHE_NAME });
    }
  })());
});
`;
    this.emitFile({ type: 'asset', fileName: 'sw.js', source });
  },
});

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/pdf-overlay-mvp/' : '/',
  plugins: [react(), offlineServiceWorker()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
