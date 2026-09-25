import { useEffect, useMemo, useRef, useState } from 'react';

import { ControlPanel } from './components/ControlPanel';
import { PageCanvas } from './components/PageCanvas';
import { TemplateShelf } from './components/TemplateShelf';
import { applyTemplate, loadPdfInfo, optimizePdfBytes } from './lib/pdf';
import { createDefaultPlacement, clonePlacementForPage } from './lib/placements';
import { deleteTemplate, getOptimizePdfPreference, listTemplates, setOptimizePdfPreference, upsertTemplate } from './lib/storage';
import { downloadBlob, formatExportTimestamp, loadImageSize, makeId, readFileAsDataUrl } from './lib/files';
import { createZipBlob } from './lib/zip';
import type { OverlayRole, PdfAsset, PdfDocInfo, Placement, TemplateRecord } from './types';
import { formatBytes } from './lib/format';
import { checkOfflineReady } from './lib/offline';
import { listenForIncomingPdfs } from './lib/incomingFiles';

const APP_VERSION = '1.1.0';

type ProcessedPdf = {
  sourceName: string;
  sourceSize: number;
  blobUrl: string;
  size: number;
  blob: Blob;
};

type ProcessingTemplate = Pick<TemplateRecord, 'placements' | 'assets' | 'optimizeImages'>;

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
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [templateName, setTemplateName] = useState('Без названия');
  const [sourceDoc, setSourceDoc] = useState<PdfDocInfo | null>(null);
  const [targetDocs, setTargetDocs] = useState<PdfDocInfo[]>([]);
  const [assets, setAssets] = useState<Record<OverlayRole, PdfAsset | null>>({ stamp: null, signature: null });
  const [placements, setPlacements] = useState<Placement[]>([]);
  const placementHistoryRef = useRef<Placement[][]>([]);
  const [historyDepth, setHistoryDepth] = useState(0);
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [activePlacementId, setActivePlacementId] = useState<string | null>(null);
  const [optimizeImages, setOptimizeImages] = useState(true);
  const [optimizePdf, setOptimizePdf] = useState(getOptimizePdfPreference);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [outputResults, setOutputResults] = useState<ProcessedPdf[]>([]);
  const [quickMode, setQuickMode] = useState(false);
  const [quickTemplate, setQuickTemplate] = useState<TemplateRecord | null>(null);
  const [quickExportReady, setQuickExportReady] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [offlineStatus, setOfflineStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [compactMode, setCompactMode] = useState(() => window.matchMedia('(max-width: 720px), (pointer: coarse)').matches);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExportingAll, setIsExportingAll] = useState(false);

  useEffect(() => {
    let mounted = true;
    void listTemplates().then((storedTemplates) => {
      if (mounted) setTemplates(storedTemplates);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let checkNumber = 0;
    const check = () => {
      const currentCheck = ++checkNumber;
      if (mounted) setOfflineStatus('checking');
      void checkOfflineReady().then((ready) => {
        if (mounted && currentCheck === checkNumber) setOfflineStatus(ready ? 'ready' : 'unavailable');
      });
    };
    check();
    navigator.serviceWorker?.addEventListener('controllerchange', check);
    window.addEventListener('online', check);
    return () => {
      mounted = false;
      navigator.serviceWorker?.removeEventListener('controllerchange', check);
      window.removeEventListener('online', check);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px), (pointer: coarse)');
    const update = () => setCompactMode(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
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

  const activePlacement = useMemo(
    () => placements.find((placement) => placement.id === activePlacementId) ?? null,
    [placements, activePlacementId],
  );

  const rememberPlacements = () => {
    placementHistoryRef.current = [...placementHistoryRef.current.slice(-29), placements.map((item) => ({ ...item }))];
    setHistoryDepth(placementHistoryRef.current.length);
  };

  const clearPlacementHistory = () => {
    placementHistoryRef.current = [];
    setHistoryDepth(0);
  };

  const handleUndo = () => {
    const previous = placementHistoryRef.current.pop();
    if (!previous) return;
    setPlacements(previous);
    setHistoryDepth(placementHistoryRef.current.length);
    setBusyMessage('Последнее действие отменено.');
  };

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

  useEffect(() => listenForIncomingPdfs(
    async (files) => {
      await loadTargetPdfs(files);
      setBusyMessage(`Получено из другого приложения: ${files.length} PDF. Выберите шаблон и запустите обработку.`);
    },
    (message) => setBusyMessage(`Ошибка приёма PDF: ${message}`),
  ), []);

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

  const clearOutputResults = () => {
    outputResults.forEach((item) => URL.revokeObjectURL(item.blobUrl));
    setOutputResults([]);
    setPreviewIndex(0);
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

  const handleSaveTemplate = async (saveAsNew = false) => {
    if (!sourceDoc) {
      setBusyMessage('Сначала загрузите исходный PDF.');
      return;
    }
    if (!assets.stamp && !assets.signature) {
      setBusyMessage('Нужна хотя бы одна картинка: печать или подпись.');
      return;
    }

    const id = saveAsNew || !activeTemplateId ? makeId('template') : activeTemplateId;
    const now = new Date().toISOString();
    const existingTemplate = templates.find((template) => template.id === id);
    const record: TemplateRecord = {
      id,
      name: templateName.trim() || 'Без названия',
      createdAt: existingTemplate?.createdAt ?? now,
      updatedAt: now,
      pageCount: sourceDoc.pageMetrics.length,
      pageMetrics: sourceDoc.pageMetrics,
      placements,
      assets,
      optimizeImages,
    };
    try {
      await upsertTemplate(record);
      setTemplates(await listTemplates());
      setActiveTemplateId(id);
      setBusyMessage(`Шаблон "${record.name}" сохранён локально${saveAsNew ? ' как новый' : ''}.`);
      void navigator.storage?.persist?.();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'неизвестная ошибка';
      setBusyMessage(`Не удалось сохранить шаблон: ${detail}. Освободите место на устройстве и повторите.`);
    }
  };

  const handleSelectTemplate = (template: TemplateRecord) => {
    setTemplateName(template.name);
    setPlacements(template.placements);
    setAssets(template.assets);
    setOptimizeImages(template.optimizeImages);
    setSelectedPageIndex(0);
    setActiveTemplateId(template.id);
    clearPlacementHistory();
    setBusyMessage(`Шаблон "${template.name}" загружен.`);
  };

  const handleDeleteTemplate = async (templateId: string) => {
    await deleteTemplate(templateId);
    const next = await listTemplates();
    setTemplates(next);
    if (templateId === activeTemplateId) {
      setActiveTemplateId(null);
    }
  };

  const handleRenameTemplate = async (templateId: string, name: string) => {
    const template = templates.find((item) => item.id === templateId);
    const nextName = name.trim();
    if (!template || !nextName) return;
    await upsertTemplate({ ...template, name: nextName, updatedAt: new Date().toISOString() });
    setTemplates(await listTemplates());
    if (templateId === activeTemplateId) setTemplateName(nextName);
    setBusyMessage(`Шаблон переименован в «${nextName}».`);
  };

  const handleToggleTemplateOptimization = async (templateId: string, enabled: boolean) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template || isProcessing) return;
    const updated = { ...template, optimizeImages: enabled, updatedAt: new Date().toISOString() };
    await upsertTemplate(updated);
    setTemplates(await listTemplates());
    if (templateId === activeTemplateId) setOptimizeImages(enabled);
    if (templateId === quickTemplate?.id) setQuickTemplate(updated);
    clearOutputResults();
    setQuickMode(false);
    setQuickExportReady(false);
    setBusyMessage(`${enabled ? 'Облегчение результата включено' : 'Облегчение результата выключено'} для шаблона «${template.name}».`);
  };

  const handleAddPlacement = (role: OverlayRole) => {
    if (!sourceDoc) return;
    rememberPlacements();
    const placement = createDefaultPlacement(role, selectedPageIndex, sourceDoc.pageMetrics[selectedPageIndex]);
    setPlacements((current) => [...current.filter((item) => !(item.pageIndex === selectedPageIndex && item.role === role)), placement]);
    setActivePlacementId(placement.id);
  };

  const handleRemovePlacement = (placementId: string) => {
    const placement = placements.find((item) => item.id === placementId);
    if (!placement) return;
    rememberPlacements();
    setPlacements((current) => current.filter((item) => item.id !== placementId));
    setActivePlacementId(null);
    clearOutputResults();
    setBusyMessage(`${placement.role === 'stamp' ? 'Печать' : 'Подпись'} удалена со страницы ${placement.pageIndex + 1}. Можно отменить.`);
  };

  const handleRemoveAsset = (role: OverlayRole) => {
    setAssets((current) => ({ ...current, [role]: null }));
    clearOutputResults();
    setBusyMessage(`${role === 'stamp' ? 'Печать' : 'Подпись'} PNG убрана. Координаты сохранены; для обновления шаблона сохраните его снова.`);
  };

  const handleCopyPagePlacements = (sourcePageIndex: number, targetPageIndex: number | 'all') => {
    if (!sourceDoc) return;
    const selectedPlacements = placements.filter((placement) => placement.pageIndex === sourcePageIndex);
    if (selectedPlacements.length === 0) {
      setBusyMessage('На этой странице нет объектов для копирования.');
      return;
    }

    if (targetPageIndex === 'all') {
      rememberPlacements();
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
    rememberPlacements();
    setPlacements((current) => copyPlacements(current, sourcePageIndex, targetPageIndex));
  };

  const processDocs = async (docs: PdfDocInfo[], template: ProcessingTemplate, initialErrors: string[] = []) => {
    setBusyMessage(`Обрабатываю PDF: 0 из ${docs.length}...`);
    outputResults.forEach((item) => URL.revokeObjectURL(item.blobUrl));
    const nextResults: ProcessedPdf[] = [];
    const errors = [...initialErrors];
    const warnings: string[] = [];
    for (let index = 0; index < docs.length; index += 1) {
      try {
        const doc = docs[index];
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        let bytes = doc.bytes;
        if (optimizePdf) {
          setBusyMessage(`Оптимизирую PDF: ${index + 1} из ${docs.length} — ${doc.name}`);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          try {
            bytes = (await optimizePdfBytes(doc.bytes)).bytes;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'неизвестная ошибка';
            warnings.push(`${doc.name}: оптимизация не выполнена (${message}); использован исходный PDF.`);
          }
        }
        setBusyMessage(`Обрабатываю PDF: ${index + 1} из ${docs.length} — ${doc.name}`);
        const result = await applyTemplate(bytes, doc.pageMetrics, template.placements, template.assets, template.optimizeImages);
        nextResults.push({
          sourceName: doc.name,
          sourceSize: doc.fileSize,
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
    setBatchErrors([...errors, ...warnings]);
    setPreviewIndex(0);
    setBusyMessage(`Готово: ${nextResults.length} из ${docs.length + initialErrors.length}${errors.length ? `, ошибок: ${errors.length}` : ''}${warnings.length ? `, предупреждений: ${warnings.length}` : ''}.`);
    return nextResults;
  };

  const handleApplyTemplate = async () => {
    if (isProcessing) return [];
    const docs = targetDocs.length > 0 ? targetDocs : sourceDoc ? [sourceDoc] : [];
    if (docs.length === 0) {
      setBusyMessage('Сначала загрузите PDF.');
      return [];
    }
    setQuickMode(false);
    setQuickTemplate(null);
    setQuickExportReady(false);
    setIsProcessing(true);
    try {
      return await processDocs(docs, { placements, assets, optimizeImages });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickProcess = async (template: TemplateRecord, files: File[]) => {
    if (isProcessing || files.length === 0) return;
    setQuickMode(true);
    setQuickTemplate(template);
    setQuickExportReady(false);
    clearOutputResults();
    setBatchErrors([]);
    setIsProcessing(true);
    const docs: PdfDocInfo[] = [];
    const readErrors: string[] = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        setBusyMessage(`Читаю PDF для шаблона «${template.name}»: ${index + 1} из ${files.length}...`);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        try {
          docs.push(await readPdf(files[index]));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'не удалось прочитать PDF';
          readErrors.push(`${files[index].name}: ${message}`);
        }
      }
      if (docs.length === 0) {
        setBatchErrors(readErrors);
        setBusyMessage('Не удалось открыть выбранные PDF.');
        return;
      }
      const results = await processDocs(docs, template, readErrors);
      if (results.length === 0) return;
      await downloadResults(results);
      setQuickExportReady(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка';
      setBusyMessage(`Автоматический экспорт не начался: ${message}. Готовые файлы можно скачать ниже.`);
      setQuickExportReady(true);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadResults = async (results: ProcessedPdf[]) => {
    if (results.length === 0) return;
    const timestamp = formatExportTimestamp();
    if (results.length === 1) {
      const result = results[0];
      downloadBlob(result.blob, `${result.sourceName.replace(/\.pdf$/i, '')}-готово-${timestamp}.pdf`);
      setBusyMessage('Сохранение готового PDF запущено. Проверьте загрузки браузера.');
      return;
    }
    const entries = results.map((result) => ({
      blob: result.blob,
      fileName: `${result.sourceName.replace(/\.pdf$/i, '')}-готово-${timestamp}.pdf`,
    }));
    const archive = await createZipBlob(entries);
    downloadBlob(archive, `готовые-pdf-${timestamp}.zip`);
    setBusyMessage(`Сохранение ZIP с ${entries.length} PDF запущено. Проверьте загрузки браузера.`);
  };

  const handleExportPdf = async () => {
    if (isProcessing || isExportingAll) return;
    const results = await handleApplyTemplate();
    try {
      await downloadResults(results);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка';
      setBusyMessage(`Не удалось сохранить PDF: ${message}. Готовые файлы доступны ниже.`);
    }
  };

  const downloadResult = async (index: number) => {
    const result = outputResults[index];
    if (result) await downloadResults([result]);
  };

  const handleExportAll = async () => {
    if (isExportingAll || outputResults.length === 0) return;
    setIsExportingAll(true);
    setBusyMessage(`Готовлю экспорт ${outputResults.length} PDF…`);
    try {
      await downloadResults(outputResults);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка';
      setBusyMessage(`Не удалось экспортировать все PDF: ${message}`);
    } finally {
      setIsExportingAll(false);
    }
  };

  const handlePlacementUpdate = (placementId: string, patch: Partial<Placement>) => {
    setPlacements((current) => updatePlacement(current, placementId, patch));
  };

  const currentAssets = assets;

  return (
    <div className="appShell">
      <header className="hero">
        <div className="heroCopy">
          <div className="eyebrow versionLine">
            <span className="versionBadge">Версия {APP_VERSION}</span>
            <span>Локально. Без сервера. {offlineStatus === 'ready' ? 'Офлайн готов.' : offlineStatus === 'checking' ? 'Готовлю офлайн...' : 'Офлайн не готов.'}</span>
          </div>
          <h1>PDF overlay MVP</h1>
          <p>Печать и подпись на PDF. Шаблоны и пакетный экспорт без отправки файлов на сервер.</p>
          {offlineStatus === 'unavailable' && import.meta.env.PROD ? (
            <button type="button" className="offlineRetry" onClick={() => {
              setOfflineStatus('checking');
              void checkOfflineReady().then((ready) => setOfflineStatus(ready ? 'ready' : 'unavailable'));
            }}>Повторить сохранение для офлайна</button>
          ) : null}
          <details className="offlineHelp">
            <summary>Как работать на iPhone без интернета</summary>
            <p>Откройте сайт в Safari, добавьте его на экран «Домой», затем откройте приложение с иконки при наличии сети и дождитесь «Офлайн готов». После этого PDF можно обрабатывать без сети. Шаблоны в Safari и приложении с экрана «Домой» могут храниться отдельно.</p>
          </details>
        </div>
      </header>

      <main className="layout">
        <TemplateShelf
          templates={templates}
          activeTemplateId={activeTemplateId}
          onSelect={handleSelectTemplate}
          onQuickProcess={handleQuickProcess}
          onToggleOptimization={handleToggleTemplateOptimization}
          onRename={handleRenameTemplate}
          onDelete={handleDeleteTemplate}
          isProcessing={isProcessing}
        />
        {quickMode ? (
          <div className="quickFeedback" role="status">
            {quickTemplate ? <strong>Шаблон: {quickTemplate.name}</strong> : null}
            <span>{busyMessage ?? 'Готов к быстрой обработке.'}</span>
            {quickExportReady && outputResults.length > 0 ? (
              <button type="button" onClick={() => void handleExportAll()} disabled={isProcessing || isExportingAll}>
                Скачать ещё раз {outputResults.length > 1 ? `(${outputResults.length} PDF в ZIP)` : 'PDF'}
              </button>
            ) : null}
            {batchErrors.length > 0 ? <small>{batchErrors.join(' · ')}</small> : null}
          </div>
        ) : null}
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
              <small className="batchQueueHint">К каждому PDF применяется текущий шаблон. Итог сохраняется одним ZIP.</small>
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

          <div className="pdfOptimization">
            <label className="pdfOptimizeToggle">
              <input
                type="checkbox"
                checked={optimizePdf}
                disabled={isProcessing}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setOptimizePdf(enabled);
                  setOptimizePdfPreference(enabled);
                  clearOutputResults();
                }}
              />
              <span>Оптимизировать PDF перед обработкой</span>
            </label>
            <small>Выбор сохраняется на этом устройстве. Сканы внутри PDF не перекодируются и могут не уменьшиться.</small>
          </div>

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
              onBeginPlacementChange={rememberPlacements}
              onUpdatePlacement={handlePlacementUpdate}
              canUndo={historyDepth > 0}
              onUndo={handleUndo}
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
              onRemovePlacement={handleRemovePlacement}
              onRemoveAsset={handleRemoveAsset}
              onBeginPlacementChange={rememberPlacements}
              onUpdatePlacement={handlePlacementUpdate}
              onCopyPagePlacements={handleCopyPagePlacements}
              onSaveTemplate={() => void handleSaveTemplate(false)}
              onSaveTemplateAsNew={() => void handleSaveTemplate(true)}
              onApplyTemplate={handleApplyTemplate}
              onExportPdf={handleExportPdf}
              isProcessing={isProcessing}
              sourceSize={quickMode ? outputResults[previewIndex]?.sourceSize ?? 0 : sourceDoc?.fileSize ?? 0}
              outputSize={outputResults[previewIndex]?.size}
              outputTemplate={quickMode ? quickTemplate : activeTemplateId ? templates.find((item) => item.id === activeTemplateId) ?? null : null}
            />
          </div>

          {outputResults.length > 0 ? (
            <section className="panel previewPanel">
              <div className="panelHeader previewHeader">
                <div>
                  <div className="eyebrow">Предпросмотр</div>
                  <h3>Готовые файлы ({outputResults.length})</h3>
                </div>
                <div className="previewActions">
                  <a href={outputResults[previewIndex].blobUrl} target="_blank" rel="noreferrer">
                    Открыть PDF
                  </a>
                  {outputResults.length > 1 ? (
                    <button
                      className="downloadAllButton"
                      type="button"
                      onClick={() => void handleExportAll()}
                      disabled={isExportingAll}
                    >
      {isExportingAll ? 'Готовлю ZIP…' : `Скачать все (${outputResults.length}) ZIP`}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="resultList">
                {outputResults.map((result, index) => (
                  <div className={`resultItem ${previewIndex === index ? 'active' : ''}`} key={`${result.sourceName}-${index}`}>
                    <button type="button" onClick={() => setPreviewIndex(index)}>
                      <strong>{result.sourceName}</strong>
                      <small>{formatBytes(result.sourceSize)} → {formatBytes(result.size)}</small>
                    </button>
                    <button className="downloadButton" type="button" onClick={() => void downloadResult(index)}>Экспорт</button>
                  </div>
                ))}
              </div>
              {compactMode ? (
                <div className="mobilePreviewNotice">
                  Предпросмотр внутри страницы отключён для экономии памяти iPhone. Используйте «Открыть PDF» или «Экспорт».
                </div>
              ) : (
                <iframe className="pdfPreviewFrame" src={outputResults[previewIndex].blobUrl} title="Предпросмотр PDF" />
              )}
            </section>
          ) : null}
        </section>
      </main>
    </div>
  );
}
