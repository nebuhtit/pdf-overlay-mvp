import { useState } from 'react';

import type { TemplateRecord } from '../types';
import { formatBytes, formatDateTime } from '../lib/format';
import { getPlacementLabel } from '../lib/placements';

type Props = {
  templates: TemplateRecord[];
  activeTemplateId: string | null;
  onSelect: (template: TemplateRecord) => void;
  onRename: (templateId: string, name: string) => void;
  onDelete: (templateId: string) => void;
};

export function TemplateShelf({ templates, activeTemplateId, onSelect, onRename, onDelete }: Props) {
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
                  <span>{template.optimizeImages ? 'Оптимизация включена' : 'Оптимизация выключена'}</span>
                  <span>{formatBytes(new Blob([JSON.stringify(template)]).size)}</span>
                </div>
                <div className="templateActions">
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
