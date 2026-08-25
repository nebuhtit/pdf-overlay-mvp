import { useEffect, useMemo, useState } from 'react';

import { ControlPanel } from './components/ControlPanel';
import { PageCanvas } from './components/PageCanvas';
import { TemplateShelf } from './components/TemplateShelf';
import { applyTemplate, loadPdfInfo } from './lib/pdf';
import { createDefaultPlacement, clonePlacementForPage } from './lib/placements';
import { deleteTemplate, listTemplates, upsertTemplate } from './lib/storage';
import { downloadBlob, loadImageSize, makeId, readFileAsDataUrl } from './lib/files';
import type { OverlayRole, PdfAsset, PdfDocInfo, Placement, TemplateRecord } from './types';
import { formatBytes } from './lib/format';

const ensureActivePlacement = (placements: Placement[], pageIndex: number) => {
  const currentPagePlacements = placements.filter((placement) => placement.pageIndex === pageIndex);
  if (currentPagePlacements.length > 0) return currentPagePlacements[0].id;
  return null;
};

const updatePlacement = (placements: Placement[], placementId: string, patch: Partial<Placement>) =>
  placements.map((placement) => (placement.id === placementId ? { ...placement, ...patch } : placement));

const copyPlacements = (placements: Placement[], sourcePageIndex: number, targetPageIndex: number) => {
  const source = placements.filter((placement) => placement.pageIndex === sourcePageIndex);
  const targetRemoved = placements.filter((placement) => placement.pageIndex !== targetPageIndex);
  return targetRemoved.concat(source.map((placement) => clonePlacementForPage(placement, targetPageIndex)));
};

export default function App() {
  const [templates, setTemplates] = useState<TemplateRecord[]>(() => listTemplates());
  const [templateName, setTemplateName] = useState('Без названия');
  const [sourceDoc, setSourceDoc] = useState<PdfDocInfo | null>(null);
  const [targetDocs, setTargetDocs] = useState<PdfDocInfo[]>([]);
  const [assets, setAssets] = useState<Record<OverlayRole, PdfAsset | null>>({ stamp: null, signature: null });
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [activePlacementId, setActivePlacementId] = useState<string | null>(null);
  const [optimizeImages, setOptimizeImages] = useState(true);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [outputResults, setOutputResults] = useState<Array<{
    sourceName: string;
    sourceSize: number;
    blobUrl: string;
    size: number;
    blob: Blob;
  }>>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [templateCountHint, setTemplateCountHint] = useState<string>('Загрузите PDF, чтобы начать.');

  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!sourceDoc) return;
    setPlacements((current) => {
      if (current.length > 0) return current;
      const next: Placement[] = [];
      next.push(createDefaultPlacement('stamp', 0, sourceDoc.pageMetrics[0]));
      next.push(createDefaultPlacement('signature', 0, sourceDoc.pageMetrics[0]));
      return next;
    });
    setSelectedPageIndex(0);
  }, [sourceDoc]);

  useEffect(() => {
    if (!placements.length) return;
    const nextActive = ensureActivePlacement(placements, selectedPageIndex);
    setActivePlacementId(nextActive);
  }, [placements, selectedPageIndex]);

  useEffect(() => {
    if (!sourceDoc) return;
    setTemplateCountHint(`${sourceDoc.pageMetrics.length} страниц`);
  }, [sourceDoc]);

  const activePlacement = useMemo(
    () => placements.find((placement) => placement.id === activePlacementId) ?? null,
    [placements, activePlacementId],
  );

  const readPdf = async (file: File): Promise<PdfDocInfo> => {
    const info = await loadPdfInfo(file);
    return {
      name: file.name,
      fileSize: file.size,
      bytes: info.bytes,
      pageMetrics: info.pageMetrics,
    };
  };

  const loadPdf = async (file: File) => {
    const doc = await readPdf(file);

    setSourceDoc(doc);
    setPlacements((current) => {
      if (current.length > 0) return current;
      return [
        createDefaultPlacement('stamp', 0, doc.pageMetrics[0]),
        createDefaultPlacement('signature', 0, doc.pageMetrics[0]),
      ];
    });
  };

  const loadTargetPdfs = async (files: File[]) => {
    if (files.length === 0) return;
    setBusyMessage(`Загружаю PDF: 0 из ${files.length}...`);
    const docs: PdfDocInfo[] = [];
    const errors: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      try {
        docs.push(await readPdf(files[index]));
      } catch {
        errors.push(`${files[index].name}: не удалось прочитать PDF`);
      }
      setBusyMessage(`Загружаю PDF: ${index + 1} из ${files.length}...`);
    }
    setTargetDocs(docs);
    setBatchErrors(errors);
    setBusyMessage(`В очереди ${docs.length} PDF${errors.length ? `, ошибок: ${errors.length}` : ''}.`);
  };

  const removeTargetPdf = (index: number) => {
    setTargetDocs((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const clearTargetPdfs = () => {
    setTargetDocs([]);
    setBatchErrors([]);
    outputResults.forEach((item) => URL.revokeObjectURL(item.blobUrl));
    setOutputResults([]);
    setPreviewIndex(0);
    setBusyMessage('Очередь очищена.');
  };

  const loadAsset = async (file: File, role: OverlayRole) => {
    const dataUrl = await readFileAsDataUrl(file);
    const size = await loadImageSize(dataUrl);
    const asset: PdfAsset = {
      role,
      name: role === 'stamp' ? 'Печать' : 'Подпись',
      fileName: file.name,
      mimeType: file.type || 'image/png',
      dataUrl,
      byteSize: file.size,
      width: size.width,
      height: size.height,
    };
    setAssets((current) => ({ ...current, [role]: asset }));
  };

  const handleSaveTemplate = () => {
    if (!sourceDoc) {
      setBusyMessage('Сначала загрузите исходный PDF.');
      return;
    }
    if (!assets.stamp && !assets.signature) {
      setBusyMessage('Нужна хотя бы одна картинка: печать или подпись.');
      return;
    }

    const id = activeTemplateId ?? makeId('template');
    const now = new Date().toISOString();
    const record: TemplateRecord = {
      id,
      name: templateName.trim() || 'Без названия',
      createdAt: now,
      updatedAt: now,
      pageCount: sourceDoc.pageMetrics.length,
      pageMetrics: sourceDoc.pageMetrics,
      placements,
      assets,
      optimizeImages,
    };
    upsertTemplate(record);
    setTemplates(listTemplates());
    setActiveTemplateId(id);
    setBusyMessage(`Шаблон "${record.name}" сохранён локально.`);
  };

  const handleSelectTemplate = (template: TemplateRecord) => {
    setTemplateName(template.name);
    setPlacements(template.placements);
    setAssets(template.assets);
    setOptimizeImages(template.optimizeImages);
    setSelectedPageIndex(0);
    setActiveTemplateId(template.id);
    setBusyMessage(`Шаблон "${template.name}" загружен.`);
  };

  const handleDeleteTemplate = (templateId: string) => {
    deleteTemplate(templateId);
    const next = listTemplates();
    setTemplates(next);
    if (templateId === activeTemplateId) {
      setActiveTemplateId(null);
    }
  };

  const handleAddPlacement = (role: OverlayRole) => {
    if (!sourceDoc) return;
    const placement = createDefaultPlacement(role, selectedPageIndex, sourceDoc.pageMetrics[selectedPageIndex]);
    setPlacements((current) => [...current.filter((item) => !(item.pageIndex === selectedPageIndex && item.role === role)), placement]);
    setActivePlacementId(placement.id);
  };

  const handleCopyPagePlacements = (sourcePageIndex: number, targetPageIndex: number | 'all') => {
    if (!sourceDoc) return;
    const selectedPlacements = placements.filter((placement) => placement.pageIndex === sourcePageIndex);
    if (selectedPlacements.length === 0) {
      setBusyMessage('На этой странице нет объектов для копирования.');
      return;
    }

    if (targetPageIndex === 'all') {
      const pagePlacements = placements.filter((placement) => placement.pageIndex !== sourcePageIndex);
      const cloned: Placement[] = [];
      for (let index = 0; index < sourceDoc.pageMetrics.length; index += 1) {
        if (index === sourcePageIndex) continue;
        cloned.push(...selectedPlacements.map((placement) => clonePlacementForPage(placement, index)));
      }
      setPlacements([...pagePlacements, ...selectedPlacements, ...cloned]);
      return;
    }

    if (targetPageIndex < 0 || targetPageIndex >= sourceDoc.pageMetrics.length) return;
    setPlacements((current) => copyPlacements(current, sourcePageIndex, targetPageIndex));
  };

  const handleApplyTemplate = async () => {
    const docs = targetDocs.length > 0 ? targetDocs : sourceDoc ? [sourceDoc] : [];
    if (docs.length === 0) {
      setBusyMessage('Сначала загрузите PDF.');
      return;
    }
    setBusyMessage(`Обрабатываю PDF: 0 из ${docs.length}...`);
    outputResults.forEach((item) => URL.revokeObjectURL(item.blobUrl));
    const nextResults = [];
    const errors: string[] = [];
    for (let index = 0; index < docs.length; index += 1) {
      try {
        const doc = docs[index];
        const result = await applyTemplate(doc.bytes, doc.pageMetrics, placements, assets, optimizeImages);
        nextResults.push({
          sourceName: doc.name,
          sourceSize: result.sourceSize,
          blobUrl: URL.createObjectURL(result.blob),
          size: result.outputSize,
          blob: result.blob,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'неизвестная ошибка';
        errors.push(`${docs[index].name}: ${message}`);
      }
      setBusyMessage(`Обрабатываю PDF: ${index + 1} из ${docs.length}...`);
    }
    setOutputResults(nextResults);
    setBatchErrors(errors);
    setPreviewIndex(0);
    setBusyMessage(`Готово: ${nextResults.length} из ${docs.length}${errors.length ? `, ошибок: ${errors.length}` : ''}.`);
  };

  const handleExportPdf = async () => {
    if (outputResults.length === 0) {
      await handleApplyTemplate();
      return;
    }
    setBusyMessage('Скачайте нужные файлы из списка готовых результатов.');
  };

  const downloadResult = (index: number) => {
    const result = outputResults[index];
    if (!result) return;
    const baseName = result.sourceName.replace(/\.pdf$/i, '');
    downloadBlob(result.blob, `${baseName}-готово.pdf`);
  };

  const handlePlacementUpdate = (placementId: string, patch: Partial<Placement>) => {
    setPlacements((current) => updatePlacement(current, placementId, patch));
  };

  const currentAssets = assets;

  return (
    <div className="appShell">
      <header className="hero">
        <div className="heroCopy">
          <div className="eyebrow">Локально. Без сервера. Для iPhone и Mac.</div>
          <h1>PDF overlay MVP</h1>
          <p>
            Загружайте PDF, ставьте печать и подпись на нужные страницы, сохраняйте шаблоны и применяйте их к
            другим документам в браузере.
          </p>
        </div>
        <div className="heroStats">
          <div>
            <span>Шаблонов</span>
            <strong>{templates.length}</strong>
          </div>
          <div>
            <span>Страниц в проекте</span>
            <strong>{templateCountHint}</strong>
          </div>
          <div>
            <span>Приватность</span>
            <strong>локально</strong>
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="panel uploads">
          <div className="panelHeader">
            <div>
              <div className="eyebrow">Файлы</div>
              <h3>Загрузка и источники</h3>
            </div>
            <div className="panelMeta">{sourceDoc ? formatBytes(sourceDoc.fileSize) : 'PDF не выбран'}</div>
          </div>

          <div className="uploadGrid">
            <label className="uploadCard">
              <span>Исходный PDF</span>
              <strong>{sourceDoc?.name ?? 'Выбрать PDF'}</strong>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file) await loadPdf(file);
                }}
              />
            </label>
            <label className="uploadCard">
              <span>Печать PNG</span>
              <strong>{assets.stamp?.fileName ?? 'Выбрать PNG'}</strong>
              <input
                type="file"
                accept="image/png,.png"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file) await loadAsset(file, 'stamp');
                }}
              />
            </label>
            <label className="uploadCard">
              <span>Подпись PNG</span>
              <strong>{assets.signature?.fileName ?? 'Выбрать PNG'}</strong>
              <input
                type="file"
                accept="image/png,.png"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file) await loadAsset(file, 'signature');
                }}
              />
            </label>
            <label className="uploadCard">
              <span>Целевой PDF</span>
              <strong>{targetDocs.length ? `Выбрано: ${targetDocs.length}` : 'Выбрать несколько PDF'}</strong>
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={async (event) => {
                  await loadTargetPdfs(Array.from(event.target.files ?? []));
                }}
              />
            </label>
          </div>

          {targetDocs.length > 0 ? (
            <div className="batchQueue">
              <div className="batchQueueHeader">
                <strong>Очередь: {targetDocs.length}</strong>
                <button type="button" onClick={clearTargetPdfs}>Очистить</button>
              </div>
              {targetDocs.map((doc, index) => (
                <div className="batchQueueItem" key={`${doc.name}-${doc.fileSize}-${index}`}>
                  <div>
                    <strong>{doc.name}</strong>
                    <small>{doc.pageMetrics.length} стр. · {formatBytes(doc.fileSize)}</small>
                  </div>
                  <button type="button" aria-label={`Удалить ${doc.name}`} onClick={() => removeTargetPdf(index)}>Удалить</button>
                </div>
              ))}
            </div>
          ) : null}

          {batchErrors.length > 0 ? (
            <div className="batchErrors" role="alert">
              {batchErrors.map((message, index) => <div key={`${message}-${index}`}>{message}</div>)}
            </div>
          ) : null}

          <div className="statusLine">{busyMessage ?? 'Готов к работе.'}</div>
        </section>

        <section className="workspace">
          <div className="pageRail">
            {(sourceDoc?.pageMetrics ?? []).map((metrics, index) => {
              const pagePlacements = placements.filter((placement) => placement.pageIndex === index);
              const active = index === selectedPageIndex;
              return (
                <button
                  key={`${metrics.width}-${metrics.height}-${index}`}
                  className={`pageChip ${active ? 'active' : ''}`}
                  type="button"
                  onClick={() => setSelectedPageIndex(index)}
                >
                  <span>Стр. {index + 1}</span>
                  <small>
                    {Math.round(metrics.width)}×{Math.round(metrics.height)}
                  </small>
                  <small>{pagePlacements.length} блоков</small>
                </button>
              );
            })}
          </div>

          <div className="editorGrid">
            <PageCanvas
              sourceBytes={sourceDoc?.bytes ?? null}
              pageIndex={selectedPageIndex}
              pageMetrics={sourceDoc?.pageMetrics ?? []}
              placements={placements.filter((placement) => placement.pageIndex === selectedPageIndex)}
              stampUrl={currentAssets.stamp?.dataUrl}
              signatureUrl={currentAssets.signature?.dataUrl}
              activePlacementId={activePlacementId}
              onSelectPlacement={setActivePlacementId}
              onUpdatePlacement={handlePlacementUpdate}
            />

            <ControlPanel
              templateName={templateName}
              onTemplateNameChange={setTemplateName}
              selectedPageIndex={selectedPageIndex}
              pageCount={sourceDoc?.pageMetrics.length ?? 0}
              activePlacement={activePlacement}
              assets={assets}
              optimizeImages={optimizeImages}
              onToggleOptimize={() => setOptimizeImages((value) => !value)}
              onAddPlacement={handleAddPlacement}
              onUpdatePlacement={handlePlacementUpdate}
              onCopyPagePlacements={handleCopyPagePlacements}
              onSaveTemplate={handleSaveTemplate}
              onApplyTemplate={handleApplyTemplate}
              onExportPdf={handleExportPdf}
              sourceSize={sourceDoc?.fileSize ?? 0}
              outputSize={outputResults[previewIndex]?.size}
              outputTemplate={activeTemplateId ? templates.find((item) => item.id === activeTemplateId) ?? null : null}
            />
          </div>

          <TemplateShelf
            templates={templates}
            activeTemplateId={activeTemplateId}
            onSelect={handleSelectTemplate}
            onDelete={handleDeleteTemplate}
          />

          {outputResults.length > 0 ? (
            <section className="panel previewPanel">
              <div className="panelHeader">
                <div>
                  <div className="eyebrow">Предпросмотр</div>
                  <h3>Готовые файлы ({outputResults.length})</h3>
                </div>
                <a href={outputResults[previewIndex].blobUrl} target="_blank" rel="noreferrer">
                  Открыть PDF
                </a>
              </div>
              <div className="resultList">
                {outputResults.map((result, index) => (
                  <div className={`resultItem ${previewIndex === index ? 'active' : ''}`} key={`${result.sourceName}-${index}`}>
                    <button type="button" onClick={() => setPreviewIndex(index)}>
                      <strong>{result.sourceName}</strong>
                      <small>{formatBytes(result.sourceSize)} → {formatBytes(result.size)}</small>
                    </button>
                    <button className="downloadButton" type="button" onClick={() => downloadResult(index)}>Скачать</button>
                  </div>
                ))}
              </div>
              <iframe className="pdfPreviewFrame" src={outputResults[previewIndex].blobUrl} title="Предпросмотр PDF" />
            </section>
          ) : null}
        </section>
      </main>
    </div>
  );
}
