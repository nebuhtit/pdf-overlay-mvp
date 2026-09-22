import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(resolve('dist/sw.js'), 'utf8');
const files = new Map();
const root = 'https://example.test/pdf-overlay-mvp/';
const listeners = new Map();
let offline = false;
let failInstall = false;

const caches = {
  async open(name) {
    if (!files.has(name)) files.set(name, new Map());
    const entries = files.get(name);
    return {
      async addAll(urls) {
        if (failInstall) throw new Error('network unavailable');
        for (const url of urls) {
          entries.set(url, new Response(url));
        }
      },
      async match(request) { return entries.get(typeof request === 'string' ? request : request.url)?.clone(); },
      async delete(url) { return entries.delete(url); },
    };
  },
  async keys() { return [...files.keys()]; },
  async delete(name) { return files.delete(name); },
};

vm.runInNewContext(source, {
  self: {
    registration: { scope: root },
    location: new URL(root),
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener: (name, callback) => listeners.set(name, callback),
  },
  caches,
  URL,
  Response,
  fetch: async () => {
    if (offline) throw new Error('offline');
    return new Response('network-new-version');
  },
});

const waitEvent = async (name, event = {}) => {
  let task;
  listeners.get(name)({ ...event, waitUntil: (promise) => { task = promise; } });
  await task;
};
const fetchEvent = async (url, mode = 'same-origin') => {
  let task;
  listeners.get('fetch')({
    request: { url, mode, method: 'GET' },
    respondWith: (promise) => { task = promise; },
  });
  return task;
};
const checkReady = async () => {
  let result;
  await waitEvent('message', {
    data: { type: 'CHECK_OFFLINE' },
    ports: [{ postMessage: (message) => { result = message; } }],
  });
  return result;
};

await caches.open('pdf-overlay-previous');
const oldScript = `${root}assets/old-version.js`;
files.get('pdf-overlay-previous').set(oldScript, new Response('old script'));
await waitEvent('install');
await waitEvent('activate');
const cacheName = (await caches.keys()).find((key) => key !== 'pdf-overlay-previous');
assert(files.has('pdf-overlay-previous'), 'previous cache must remain for open tabs');
const entries = files.get(cacheName);
const workerUrl = [...entries.keys()].find((url) => url.includes('/pdf.worker-'));
const scriptUrl = [...entries.keys()].find((url) => /\/assets\/index-[^/]+\.js$/.test(url));
assert(workerUrl, 'PDF worker must be precached');
assert(scriptUrl, 'application JS must be precached');
assert.equal((await checkReady()).ready, true);

offline = true;
assert.equal((await (await fetchEvent(root, 'navigate')).text()), root);
assert.equal((await (await fetchEvent(scriptUrl)).text()), scriptUrl);
assert.equal((await (await fetchEvent(workerUrl)).text()), workerUrl);
assert.equal((await (await fetchEvent(oldScript)).text()), 'old script');
const missing = await fetchEvent(`${root}assets/missing.js`);
assert.equal(missing.type, 'error', 'missing asset must not receive index.html');

offline = false;
assert.equal((await (await fetchEvent(root, 'navigate')).text()), root, 'online navigation must keep its matching shell');
assert.equal((await (await fetchEvent(scriptUrl)).text()), scriptUrl);

entries.delete(workerUrl);
assert.equal((await checkReady()).ready, false, 'readiness requires the PDF worker');
failInstall = true;
await assert.rejects(waitEvent('install'));
assert(files.has(cacheName), 'failed install must preserve the prior cache');

console.log('Offline service worker checks passed.');
