import type { TemplateRecord } from '../types';

const LEGACY_TEMPLATE_STORAGE_KEY = 'pdf-overlay-mvp.templates.v1';
const OPTIMIZE_PDF_STORAGE_KEY = 'pdf-overlay-mvp.optimize-pdf.v1';
const DATABASE_NAME = 'pdf-overlay-mvp';
const DATABASE_VERSION = 1;
const TEMPLATE_STORE = 'templates';

export const getOptimizePdfPreference = (): boolean => {
  try {
    return localStorage.getItem(OPTIMIZE_PDF_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const setOptimizePdfPreference = (enabled: boolean) => {
  try {
    localStorage.setItem(OPTIMIZE_PDF_STORAGE_KEY, String(enabled));
  } catch {
    // The current session remains usable when private browsing blocks storage.
  }
};

const readLegacyTemplates = (): TemplateRecord[] => {
  try {
    const raw = localStorage.getItem(LEGACY_TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { templates?: TemplateRecord[] };
    return Array.isArray(parsed.templates) ? parsed.templates : [];
  } catch {
    return [];
  }
};

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (!('indexedDB' in window)) {
    reject(new Error('IndexedDB недоступна'));
    return;
  }

  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(TEMPLATE_STORE)) {
      database.createObjectStore(TEMPLATE_STORE, { keyPath: 'id' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Не удалось открыть локальное хранилище'));
});

const runTransaction = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, setResult: (value: T) => void, fail: (reason?: unknown) => void) => void,
) => {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let result: T;
    const transaction = database.transaction(TEMPLATE_STORE, mode);
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Ошибка локального хранилища'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Запись в локальное хранилище отменена'));
    };
    operation(
      transaction.objectStore(TEMPLATE_STORE),
      (value) => { result = value; },
      (reason) => {
        transaction.abort();
        reject(reason);
      },
    );
  });
};

let migrationPromise: Promise<void> | null = null;

const migrateLegacyTemplates = () => {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const legacyTemplates = readLegacyTemplates();
    if (legacyTemplates.length === 0) return;

    const existingKeys = await runTransaction<IDBValidKey[]>('readonly', (store, resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const knownIds = new Set(existingKeys.map(String));
    const missingTemplates = legacyTemplates.filter((template) => !knownIds.has(template.id));

    if (missingTemplates.length > 0) {
      await runTransaction<void>('readwrite', (store, setResult) => {
        missingTemplates.forEach((template) => store.put(template));
        setResult(undefined);
      });
    }

    try {
      localStorage.removeItem(LEGACY_TEMPLATE_STORAGE_KEY);
    } catch {
      // The migrated IndexedDB copy is already complete.
    }
  })().catch((error) => {
    migrationPromise = null;
    throw error;
  });
  return migrationPromise;
};

export const listTemplates = async (): Promise<TemplateRecord[]> => {
  try {
    await migrateLegacyTemplates();
    const templates = await runTransaction<TemplateRecord[]>('readonly', (store, resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as TemplateRecord[]);
      request.onerror = () => reject(request.error);
    });
    return templates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return readLegacyTemplates().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
};

export const upsertTemplate = async (template: TemplateRecord) => {
  await migrateLegacyTemplates();
  await runTransaction<void>('readwrite', (store, setResult, reject) => {
    const request = store.put(template);
    request.onsuccess = () => setResult(undefined);
    request.onerror = () => reject(request.error);
  });
};

export const deleteTemplate = async (templateId: string) => {
  await migrateLegacyTemplates();
  await runTransaction<void>('readwrite', (store, setResult, reject) => {
    const request = store.delete(templateId);
    request.onsuccess = () => setResult(undefined);
    request.onerror = () => reject(request.error);
  });
};
