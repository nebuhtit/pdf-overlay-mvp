import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { indexedDB } from 'fake-indexeddb';

const outputPath = join(tmpdir(), `pdf-overlay-storage-${process.pid}.mjs`);
const values = new Map();
const localStorage = {
  getItem: (key) => values.get(key) ?? null,
  removeItem: (key) => values.delete(key),
  setItem: (key, value) => {
    const totalSize = [...values.entries()]
      .filter(([storedKey]) => storedKey !== key)
      .reduce((size, [storedKey, storedValue]) => size + storedKey.length + storedValue.length, key.length + value.length);
    if (totalSize > 5_000_000) throw new Error('QuotaExceededError');
    values.set(key, value);
  },
};

Object.assign(globalThis, { indexedDB, localStorage, window: globalThis });

const makeTemplate = (id, name, updatedAt, imageData) => ({
  id,
  name,
  createdAt: updatedAt,
  updatedAt,
  pageCount: 1,
  pageMetrics: [{ width: 595, height: 842 }],
  placements: [],
  assets: {
    stamp: {
      role: 'stamp',
      name: 'Печать',
      fileName: 'stamp.png',
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${imageData}`,
      byteSize: imageData.length,
      width: 100,
      height: 100,
    },
    signature: null,
  },
  optimizeImages: true,
});

const first = makeTemplate('first', 'Первый', '2026-09-01T10:00:00.000Z', 'A'.repeat(3_000_000));
localStorage.setItem('pdf-overlay-mvp.templates.v1', JSON.stringify({ templates: [first] }));

try {
  await build({
    entryPoints: ['src/lib/storage.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile: outputPath,
    logLevel: 'silent',
  });
  const storage = await import(`${pathToFileURL(outputPath).href}?test=${Date.now()}`);

  assert.deepEqual((await storage.listTemplates()).map((item) => item.id), ['first']);
  assert.equal(localStorage.getItem('pdf-overlay-mvp.templates.v1'), null, 'legacy data should be removed after migration');

  const second = makeTemplate('second', 'Второй', '2026-09-02T10:00:00.000Z', 'B'.repeat(3_000_000));
  await storage.upsertTemplate(second);
  assert.deepEqual((await storage.listTemplates()).map((item) => item.id), ['second', 'first']);

  await storage.upsertTemplate({ ...first, name: 'Первый обновлён', updatedAt: '2026-09-03T10:00:00.000Z' });
  const updated = await storage.listTemplates();
  assert.equal(updated.length, 2);
  assert.equal(updated[0].name, 'Первый обновлён');

  await storage.deleteTemplate('first');
  assert.deepEqual((await storage.listTemplates()).map((item) => item.id), ['second']);
  console.log('Template storage checks passed.');
} finally {
  await rm(outputPath, { force: true });
}
