import { createZipBlob } from './zip';

export const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export const loadImageSize = (dataUrl: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Не удалось прочитать PNG'));
    image.src = dataUrl;
  });

export const bytesFromDataUrl = async (dataUrl: string): Promise<Uint8Array> => {
  const response = await fetch(dataUrl);
  return new Uint8Array(await response.arrayBuffer());
};

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const shareOrDownloadBlob = async (blob: Blob, fileName: string) => {
  const file = new File([blob], fileName, { type: blob.type || 'application/pdf' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared' as const;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const;
      // Fall back to a normal download if Web Share fails unexpectedly.
    }
  }
  downloadBlob(blob, fileName);
  return 'downloaded' as const;
};

export const shareOrDownloadMany = async (
  entries: Array<{ blob: Blob; fileName: string }>,
  archiveName: string,
) => {
  const files = entries.map(({ blob, fileName }) => new File([blob], fileName, { type: 'application/pdf' }));
  if (navigator.share && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: 'Готовые PDF' });
      return 'shared' as const;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const;
      // ZIP remains a reliable fallback when multi-file Web Share fails.
    }
  }

  const archive = await createZipBlob(entries);
  downloadBlob(archive, archiveName);
  return 'downloaded-zip' as const;
};

export const makeId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
