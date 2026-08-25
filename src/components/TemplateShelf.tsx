import type { TemplateRecord } from '../types';
import { formatBytes, formatDateTime } from '../lib/format';
import { getPlacementLabel } from '../lib/placements';

type Props = {
  templates: TemplateRecord[];
  activeTemplateId: string | null;
  onSelect: (template: TemplateRecord) => void;
  onDelete: (templateId: string) => void;
};

export function TemplateShelf({ templates, activeTemplateId, onSelect, onDelete }: Props) {
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
                onClick={() => onSelect(template)}
                role="button"
                tabIndex={0}
              >
                <div className="templateRowTop">
                  <strong>{template.name}</strong>
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
                <button
                  className="ghostDanger"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(template.id);
                  }}
                >
                  Удалить
                </button>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
