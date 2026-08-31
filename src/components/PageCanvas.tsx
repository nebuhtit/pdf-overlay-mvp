import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import type { PageMetrics, Placement } from '../types';
import { formatBytes } from '../lib/format';
import { renderPdfPage } from '../lib/pdf';
import { getPlacementLabel } from '../lib/placements';

type Props = {
  sourceBytes: Uint8Array | null;
  pageIndex: number;
  pageMetrics: PageMetrics[];
  placements: Placement[];
  stampUrl?: string;
  signatureUrl?: string;
  activePlacementId: string | null;
  onSelectPlacement: (placementId: string) => void;
  onBeginPlacementChange: () => void;
  onUpdatePlacement: (placementId: string, patch: Partial<Placement>) => void;
  canUndo: boolean;
  onUndo: () => void;
};

type DragMode = 'move' | 'resize';

export function PageCanvas({
  sourceBytes,
  pageIndex,
  pageMetrics,
  placements,
  stampUrl,
  signatureUrl,
  activePlacementId,
  onSelectPlacement,
  onBeginPlacementChange,
  onUpdatePlacement,
  canUndo,
  onUndo,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [renderStatus, setRenderStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const metrics = pageMetrics[pageIndex];

  useEffect(() => {
    if (!wrapperRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setStageWidth(entry.contentRect.width);
    });
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!sourceBytes || !canvas || !metrics || !stageWidth) return;
    let cancelled = false;
    setRenderStatus('loading');
    renderPdfPage(sourceBytes, pageIndex, canvas, stageWidth)
      .then(() => {
        if (!cancelled) setRenderStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setRenderStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [sourceBytes, pageIndex, metrics, stageWidth]);

  const stageSize = useMemo(() => {
    if (!metrics || !stageWidth) return null;
    const height = Math.round((stageWidth * metrics.height) / metrics.width);
    return { width: stageWidth, height };
  }, [metrics, stageWidth]);

  const getImageUrl = (role: Placement['role']) => {
    if (role === 'stamp') return stampUrl;
    return signatureUrl;
  };

  const updatePlacementFromPointer = (
    event: ReactPointerEvent<HTMLElement>,
    placement: Placement,
    mode: DragMode,
  ) => {
    const target = event.currentTarget;
    const rect = target.closest('[data-stage]')?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startPlacement = { ...placement };
    const activePointer = event.pointerId;
    target.setPointerCapture(activePointer);

    const onMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const next = { ...startPlacement };

      if (mode === 'move') {
        next.x = Math.min(1 - next.width, Math.max(0, startPlacement.x + deltaX / rect.width));
        next.y = Math.min(1 - next.height, Math.max(0, startPlacement.y + deltaY / rect.height));
      } else {
        const nextWidth = Math.min(0.9, Math.max(0.06, startPlacement.width + deltaX / rect.width));
        const nextHeight = Math.min(0.9, Math.max(0.06, startPlacement.height + deltaY / rect.height));
        next.width = Math.min(1 - next.x, nextWidth);
        next.height = Math.min(1 - next.y, nextHeight);
      }

      onUpdatePlacement(placement.id, next);
    };

    const onUp = () => {
      target.releasePointerCapture(activePointer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <section className="stageCard" aria-label="Редактор страницы">
      <div className="stageHeader">
        <div>
          <div className="eyebrow">Текущая страница</div>
          <h2>
            Страница {pageIndex + 1}
            <span>/{pageMetrics.length}</span>
          </h2>
        </div>
        <div className="stageTools">
          <div className="stageMeta">
            {metrics ? `${metrics.width.toFixed(0)} × ${metrics.height.toFixed(0)} pt` : 'Нет PDF'}
            {renderStatus === 'loading' ? 'Рендер...' : renderStatus === 'error' ? 'Ошибка рендера' : ''}
          </div>
          <button className="undoButton" type="button" onClick={onUndo} disabled={!canUndo}>
            ↶ Отменить
          </button>
        </div>
      </div>

      <div className="pageStage" ref={wrapperRef} data-stage="true">
        {stageSize ? (
          <>
            <canvas ref={canvasRef} className="pdfCanvas" />
            <div className="overlayLayer" style={{ width: stageSize.width, height: stageSize.height }}>
              {placements.map((placement) => {
                const img = getImageUrl(placement.role);
                const isActive = placement.id === activePlacementId;
                const style = {
                  left: `${placement.x * 100}%`,
                  top: `${placement.y * 100}%`,
                  width: `${placement.width * 100}%`,
                  height: `${placement.height * 100}%`,
                  transform: `rotate(${placement.rotation}deg)`,
                } as const;

                return (
                  <div
                    key={placement.id}
                    className={`placementBox ${isActive ? 'isActive' : ''} ${img ? '' : 'isPlaceholder'}`}
                    style={style}
                    onPointerDown={(event) => {
                      if ((event.target as HTMLElement).dataset.handle) return;
                      onSelectPlacement(placement.id);
                      onBeginPlacementChange();
                      updatePlacementFromPointer(event, placement, 'move');
                    }}
                  >
                    {img ? (
                      <img src={img} alt={getPlacementLabel(placement.role)} draggable={false} />
                    ) : (
                      <span className="placementPlaceholder">
                        {placement.role === 'stamp' ? 'Загрузите печать PNG' : 'Загрузите подпись PNG'}
                      </span>
                    )}
                    <button
                      className="handle resize"
                      type="button"
                      data-handle="resize"
                      aria-label="Изменить размер"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        onSelectPlacement(placement.id);
                        onBeginPlacementChange();
                        updatePlacementFromPointer(event, placement, 'resize');
                      }}
                    />
                    <button
                      className="handle rotate"
                      type="button"
                      data-handle="rotate"
                      aria-label="Повернуть на 15 градусов"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectPlacement(placement.id);
                        onBeginPlacementChange();
                        onUpdatePlacement(placement.id, { rotation: (placement.rotation + 15) % 360 });
                      }}
                    />
                    <span className="placementLabel">{getPlacementLabel(placement.role)}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="emptyStage">
            <p>Загрузите PDF, чтобы начать разметку.</p>
            <small>Все файлы остаются локально в браузере.</small>
          </div>
        )}
      </div>

      <div className="pageHint">
        Перетаскивайте блоки пальцем или мышью. Нижний правый маркер меняет размер, верхний вращает на 15°.
      </div>
      {sourceBytes ? <div className="pageHint subtle">Открытый документ: {formatBytes(sourceBytes.byteLength)}</div> : null}
    </section>
  );
}
