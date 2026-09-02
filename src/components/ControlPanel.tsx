import type { OverlayRole, PdfAsset, Placement, TemplateRecord } from '../types';
import { formatBytes, formatPercent } from '../lib/format';
import { getPlacementLabel } from '../lib/placements';

type Props = {
  templateName: string;
  onTemplateNameChange: (value: string) => void;
  selectedPageIndex: number;
  pageCount: number;
  activePlacement: Placement | null;
  assets: Record<OverlayRole, PdfAsset | null>;
  optimizeImages: boolean;
  onToggleOptimize: () => void;
  onAddPlacement: (role: OverlayRole) => void;
  onBeginPlacementChange: () => void;
  onUpdatePlacement: (placementId: string, patch: Partial<Placement>) => void;
  onCopyPagePlacements: (sourcePageIndex: number, targetPageIndex: number | 'all') => void;
  onSaveTemplate: () => void;
  onApplyTemplate: () => void;
  onExportPdf: () => void;
  isProcessing: boolean;
  sourceSize: number;
  outputSize?: number;
  outputTemplate?: TemplateRecord | null;
};

export function ControlPanel({
  templateName,
  onTemplateNameChange,
  selectedPageIndex,
  pageCount,
  activePlacement,
  assets,
  optimizeImages,
  onToggleOptimize,
  onAddPlacement,
  onBeginPlacementChange,
  onUpdatePlacement,
  onCopyPagePlacements,
  onSaveTemplate,
  onApplyTemplate,
  onExportPdf,
  isProcessing,
  sourceSize,
  outputSize,
  outputTemplate,
}: Props) {
  const reduction = outputSize && sourceSize ? ((outputSize - sourceSize) / sourceSize) * 100 : null;

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <div className="eyebrow">Управление</div>
          <h3>Шаблон и экспорт</h3>
        </div>
        <button className={`toggle ${optimizeImages ? 'on' : ''}`} type="button" onClick={onToggleOptimize}>
          {optimizeImages ? 'PNG: сжимать' : 'PNG: без сжатия'}
        </button>
      </div>

      <label className="field">
        <span>Название шаблона</span>
        <input
          type="text"
          value={templateName}
          onChange={(event) => onTemplateNameChange(event.target.value)}
          placeholder="Например: Штамп+подпись для актов"
        />
      </label>

      <div className="quickActions">
        <button type="button" className="secondary" onClick={() => onAddPlacement('stamp')}>
          Добавить печать на страницу {selectedPageIndex + 1}
        </button>
        <button type="button" className="secondary" onClick={() => onAddPlacement('signature')}>
          Добавить подпись на страницу {selectedPageIndex + 1}
        </button>
      </div>

      <div className="quickActions">
        <button type="button" className="secondary" onClick={() => onCopyPagePlacements(selectedPageIndex, 'all')}>
          Скопировать текущую страницу на все
        </button>
        <button type="button" className="secondary" onClick={() => onCopyPagePlacements(selectedPageIndex, Math.max(0, selectedPageIndex - 1))}>
          Копировать на предыдущую
        </button>
      </div>

      {activePlacement ? (
        <div className="inspector">
          <div className="inspectorHeader">
            <strong>{getPlacementLabel(activePlacement.role)}</strong>
            <span>Стр. {activePlacement.pageIndex + 1}</span>
          </div>
          <div className="grid2">
            <label className="field">
              <span>X</span>
              <input
                type="range"
                min="0"
                max="0.9"
                step="0.001"
                value={activePlacement.x}
                onPointerDown={onBeginPlacementChange}
                onChange={(event) => onUpdatePlacement(activePlacement.id, { x: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Y</span>
              <input
                type="range"
                min="0"
                max="0.9"
                step="0.001"
                value={activePlacement.y}
                onPointerDown={onBeginPlacementChange}
                onChange={(event) => onUpdatePlacement(activePlacement.id, { y: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Ширина</span>
              <input
                type="range"
                min="0.06"
                max="0.9"
                step="0.001"
                value={activePlacement.width}
                onPointerDown={onBeginPlacementChange}
                onChange={(event) => onUpdatePlacement(activePlacement.id, { width: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Высота</span>
              <input
                type="range"
                min="0.06"
                max="0.9"
                step="0.001"
                value={activePlacement.height}
                onPointerDown={onBeginPlacementChange}
                onChange={(event) => onUpdatePlacement(activePlacement.id, { height: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Поворот</span>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={activePlacement.rotation}
                onPointerDown={onBeginPlacementChange}
                onChange={(event) => onUpdatePlacement(activePlacement.id, { rotation: Number(event.target.value) })}
              />
            </label>
            <label className="field inline">
              <span>Видимость</span>
              <input
                type="checkbox"
                checked={activePlacement.visible}
                onChange={(event) => {
                  onBeginPlacementChange();
                  onUpdatePlacement(activePlacement.id, { visible: event.target.checked });
                }}
              />
            </label>
          </div>
        </div>
      ) : (
        <p className="muted">Выберите блок на странице, чтобы менять координаты и размер.</p>
      )}

      <div className="assetsSummary">
        <div>
          <span>Печать</span>
          <strong>{assets.stamp ? assets.stamp.fileName : 'не загружена'}</strong>
          <small>{assets.stamp ? formatBytes(assets.stamp.byteSize) : 'PNG локально'}</small>
        </div>
        <div>
          <span>Подпись</span>
          <strong>{assets.signature ? assets.signature.fileName : 'не загружена'}</strong>
          <small>{assets.signature ? formatBytes(assets.signature.byteSize) : 'PNG локально'}</small>
        </div>
      </div>

      <div className="stack">
        <button type="button" className="primary" onClick={onSaveTemplate}>
          Сохранить шаблон
        </button>
        <button type="button" className="primary secondaryAccent" onClick={onApplyTemplate} disabled={isProcessing}>
          {isProcessing ? 'Обрабатываю PDF…' : 'Обработать выбранные PDF'}
        </button>
        <button type="button" className="primary ghost" onClick={onExportPdf} disabled={isProcessing}>
          Экспортировать готовый PDF
        </button>
      </div>

      <div className="sizeCard">
        <div>
          <span>Исходный размер</span>
          <strong>{formatBytes(sourceSize)}</strong>
        </div>
        <div>
          <span>Итоговый размер</span>
          <strong>{outputSize ? formatBytes(outputSize) : '—'}</strong>
        </div>
        {reduction !== null ? (
          <small>{formatPercent(reduction)} относительно исходника</small>
        ) : (
          <small>Браузерное уменьшение ограничено безопасной оптимизацией PNG и объектными потоками PDF.</small>
        )}
      </div>

      {outputTemplate ? (
        <div className="resultMeta">
          <span>Активный шаблон</span>
          <strong>{outputTemplate.name}</strong>
        </div>
      ) : null}
    </section>
  );
}
