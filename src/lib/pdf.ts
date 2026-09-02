import { PDFDocument, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

import type { ExportResult, PageMetrics, PdfAsset, Placement } from '../types';
import { bytesFromDataUrl } from './files';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

const PDF_OPTIMIZE_MAX_IMAGE_EDGE = 1800;

const getPdfJsDocument = async (bytes: Uint8Array) => {
  // PDF.js transfers the supplied buffer to its worker. Always pass a copy so
  // the original remains available for later pages and final PDF export.
  return pdfjsLib.getDocument({ data: bytes.slice() }).promise;
};

export const loadPdfInfo = async (file: File): Promise<{ bytes: Uint8Array; pageMetrics: PageMetrics[] }> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  const pageMetrics = doc.getPages().map((page) => ({
    width: page.getWidth(),
    height: page.getHeight(),
  }));
  return { bytes, pageMetrics };
};

export const renderPdfPage = async (
  pdfBytes: Uint8Array,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  targetWidth: number,
  signal?: AbortSignal,
) => {
  const pdf = await getPdfJsDocument(pdfBytes);
  try {
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: targetWidth / page.getViewport({ scale: 1 }).width });
    const renderCanvas = document.createElement('canvas');
    const renderContext = renderCanvas.getContext('2d');
    if (!renderContext) throw new Error('Canvas context not available');

    renderCanvas.width = Math.max(1, Math.floor(viewport.width));
    renderCanvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvasContext: renderContext, viewport }).promise;
    if (signal?.aborted) return;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context not available');
    canvas.width = renderCanvas.width;
    canvas.height = renderCanvas.height;
    context.drawImage(renderCanvas, 0, 0);
  } finally {
    await pdf.destroy();
  }
};

const decodeImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось загрузить PNG для оптимизации'));
    image.src = dataUrl;
  });

const scaleImageToMaxEdge = async (dataUrl: string) => {
  const image = await decodeImage(dataUrl);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (longest <= PDF_OPTIMIZE_MAX_IMAGE_EDGE) {
    return {
      dataUrl,
      width: image.naturalWidth,
      height: image.naturalHeight,
      byteSize: Math.round((dataUrl.length * 3) / 4),
    };
  }

  const scale = PDF_OPTIMIZE_MAX_IMAGE_EDGE / longest;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return {
      dataUrl,
      width: image.naturalWidth,
      height: image.naturalHeight,
      byteSize: Math.round((dataUrl.length * 3) / 4),
    };
  }
  context.drawImage(image, 0, 0, width, height);
  const optimizedDataUrl = canvas.toDataURL('image/png');
  return {
    dataUrl: optimizedDataUrl,
    width,
    height,
    byteSize: Math.round((optimizedDataUrl.length * 3) / 4),
  };
};

export const optimizeAssets = async (assets: Record<'stamp' | 'signature', PdfAsset | null>) => {
  const entries = await Promise.all(
    (Object.keys(assets) as Array<'stamp' | 'signature'>).map(async (role) => {
      const asset = assets[role];
      if (!asset) return [role, null] as const;
      const optimized = await scaleImageToMaxEdge(asset.dataUrl);
      return [
        role,
        {
          ...asset,
          optimizedDataUrl: optimized.dataUrl === asset.dataUrl ? undefined : optimized.dataUrl,
          optimizedByteSize: optimized.byteSize === asset.byteSize ? undefined : optimized.byteSize,
          optimizedWidth: optimized.width === asset.width ? undefined : optimized.width,
          optimizedHeight: optimized.height === asset.height ? undefined : optimized.height,
        },
      ] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<'stamp' | 'signature', PdfAsset | null>;
};

const selectAssetData = (asset: PdfAsset) => asset.optimizedDataUrl ?? asset.dataUrl;

export const applyTemplate = async (
  sourceBytes: Uint8Array,
  pageMetrics: PageMetrics[],
  placements: Placement[],
  assets: Record<'stamp' | 'signature', PdfAsset | null>,
  optimizeImages: boolean,
): Promise<ExportResult> => {
  const pdf = await PDFDocument.load(sourceBytes);
  const workingAssets = optimizeImages ? await optimizeAssets(assets) : assets;

  for (const placement of placements) {
    if (!placement.visible) continue;
    if (placement.pageIndex < 0 || placement.pageIndex >= pdf.getPageCount()) continue;
    const page = pdf.getPage(placement.pageIndex);
    if (!page) continue;

    const asset = workingAssets[placement.role];
    if (!asset) continue;

    const pageSize = pageMetrics[placement.pageIndex];
    if (!pageSize) continue;

    const imageBytes = await bytesFromDataUrl(selectAssetData(asset));
    const embedded = await pdf.embedPng(imageBytes);
    const x = placement.x * pageSize.width;
    const y = (1 - placement.y - placement.height) * pageSize.height;
    const width = placement.width * pageSize.width;
    const height = placement.height * pageSize.height;

    page.drawImage(embedded, {
      x,
      y,
      width,
      height,
      rotate: degrees(placement.rotation),
    });
  }

  const outputBytes = await pdf.save({
    useObjectStreams: true,
    updateFieldAppearances: false,
  });

  return {
    bytes: outputBytes,
    blob: new Blob([new Uint8Array(outputBytes).buffer], { type: 'application/pdf' }),
    sourceSize: sourceBytes.byteLength,
    outputSize: outputBytes.byteLength,
  };
};
