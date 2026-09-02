export type OverlayRole = 'stamp' | 'signature';

export type PageMetrics = {
  width: number;
  height: number;
};

export type PdfAsset = {
  role: OverlayRole;
  name: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  byteSize: number;
  width: number;
  height: number;
  optimizedDataUrl?: string;
  optimizedByteSize?: number;
  optimizedWidth?: number;
  optimizedHeight?: number;
};

export type Placement = {
  id: string;
  role: OverlayRole;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
};

export type TemplateRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
  pageMetrics: PageMetrics[];
  placements: Placement[];
  assets: Record<OverlayRole, PdfAsset | null>;
  optimizeImages: boolean;
};

export type PdfDocInfo = {
  name: string;
  fileSize: number;
  bytes: Uint8Array;
  pageMetrics: PageMetrics[];
  optimization?: {
    sourceSize: number;
    resultSize: number;
    reduced: boolean;
  };
};

export type ExportResult = {
  bytes: Uint8Array;
  blob: Blob;
  sourceSize: number;
  outputSize: number;
};
