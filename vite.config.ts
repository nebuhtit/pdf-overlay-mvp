import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const offlineServiceWorker = () => ({
  name: 'offline-service-worker',
  generateBundle(_options: unknown, bundle: Record<string, unknown>) {
    const files = Object.keys(bundle).filter((file) => file !== 'sw.js');
    const version = files.join('|').replace(/[^a-zA-Z0-9]/g, '').slice(-32) || 'fallback';
    const precache = ['./', './manifest.webmanifest', './icon.svg', ...files.map((file) => `./${file}`)];
    const source = `const CACHE_NAME = 'pdf-overlay-${version}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('pdf-overlay-') && key !== CACHE_NAME).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(caches.match(event.request, { ignoreSearch: event.request.mode === 'navigate' }).then((cached) => {
    if (cached) return cached;
    return fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match('./'));
  }));
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
