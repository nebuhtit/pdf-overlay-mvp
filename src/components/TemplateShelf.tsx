import { useState } from 'react';

import type { TemplateRecord } from '../types';
import { formatBytes, formatDateTime } from '../lib/format';
import { getPlacementLabel } from '../lib/placements';

type Props = {
  templates: TemplateRecord[];
  activeTemplateId: string | null;
  onSelect: (template: TemplateRecord) => void;
  onQuickProcess: (template: TemplateRecord, files: File[]) => void;
  onToggleOptimization: (templateId: string, enabled: boolean) => void;
  onRename: (templateId: string, name: string) => void;
  onDelete: (templateId: string) => void;
  isProcessing: boolean;
};

export function TemplateShelf({ templates, activeTemplateId, onSelect, onQuickProcess, onToggleOptimization, onRename, onDelete, isProcessing }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const beginRename = (template: TemplateRecord) => {
    setEditingId(template.id);
    setDraftName(template.name);
  };

  const saveRename = () => {
    if (!editingId || !draftName.trim()) return;
    onRename(editingId, draftName);
    setEditingId(null);
  };

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <div className="eyebrow">Шаблоны</div>
          <h3>Сохранённые</h3>
        </div>
        <div className="panelMeta">{templates.length} шт.</div>
      </div>
      {templates.length > 0 ? <p className="templateHint">Нажмите ⚡ и выберите файлы: для одного запустится скачивание PDF, для нескольких — ZIP.</p> : null}
      <div className="templateList">
        {templates.length === 0 ? (
          <p className="muted">Сохранённые шаблоны появятся здесь. Всё хранится локально.</p>
        ) : (
          templates.map((template) => {
            const hasStamp = Boolean(template.assets.stamp);
            const hasSignature = Boolean(template.assets.signature);
            const active = template.id === activeTemplateId;

            return (
              <article
                key={template.id}
                className={`templateRow ${active ? 'active' : ''}`}
              >
                <div className="templateRowTop">
                  {editingId === template.id ? (
                    <form className="renameTemplateForm" onSubmit={(event) => { event.preventDefault(); saveRename(); }}>
                      <input
                        type="text"
                        aria-label="Новое имя шаблона"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        maxLength={120}
                        autoFocus
                      />
                      <button type="submit" disabled={!draftName.trim()}>Сохранить</button>
                      <button type="button" onClick={() => setEditingId(null)}>Отмена</button>
                    </form>
                  ) : <strong>{template.name}</strong>}
                  <span>{formatDateTime(template.updatedAt)}</span>
                </div>
                <div className="templateRowBody">
                  <span>{template.pageCount} стр.</span>
                  <span>
                    {hasStamp ? getPlacementLabel('stamp') : 'Без печати'}
                    {' · '}
                    {hasSignature ? getPlacementLabel('signature') : 'Без подписи'}
                  </span>
                </div>
                <div className="templateRowFooter">
                  <label className="templateOptimizeToggle">
                    <input
                      type="checkbox"
                      checked={template.optimizeImages}
                      disabled={isProcessing}
                      onChange={(event) => onToggleOptimization(template.id, event.target.checked)}
                    />
                    <span>Облегчать итоговый PDF<small>Уменьшать PNG печати и подписи; сканы не сжимаются</small></span>
                  </label>
                  <span>{formatBytes(new Blob([JSON.stringify(template)]).size)}</span>
                </div>
                <div className="templateActions">
                  <label className={`quickTemplateAction ${isProcessing ? 'disabled' : ''}`}>
                    <span aria-hidden="true">⚡</span> Обработать PDF
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      multiple
                      disabled={isProcessing}
                      aria-label={`Быстрая обработка по шаблону ${template.name}`}
                      onChange={(event) => {
                        const files = Array.from(event.currentTarget.files ?? []);
                        event.currentTarget.value = '';
                        if (files.length > 0) onQuickProcess(template, files);
                      }}
                    />
                  </label>
                  <button type="button" onClick={() => onSelect(template)}>Выбрать</button>
                  <button type="button" onClick={() => beginRename(template)}>Переименовать</button>
                  <button className="ghostDanger" type="button" onClick={() => onDelete(template.id)}>Удалить</button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
