import type { TemplateRecord } from '../types';

const TEMPLATE_STORAGE_KEY = 'pdf-overlay-mvp.templates.v1';
const OPTIMIZE_PDF_STORAGE_KEY = 'pdf-overlay-mvp.optimize-pdf.v1';

export const getOptimizePdfPreference = (): boolean => {
  try {
    return localStorage.getItem(OPTIMIZE_PDF_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const setOptimizePdfPreference = (enabled: boolean) => {
  try {
    localStorage.setItem(OPTIMIZE_PDF_STORAGE_KEY, String(enabled));
  } catch {
    // Private browsing may reject persistent storage; keep the current session usable.
  }
};

type SavedTemplates = {
  templates: TemplateRecord[];
};

const readState = (): SavedTemplates => {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return { templates: [] };
    const parsed = JSON.parse(raw) as Partial<SavedTemplates>;
    return { templates: Array.isArray(parsed.templates) ? parsed.templates : [] };
  } catch {
    return { templates: [] };
  }
};

const writeState = (state: SavedTemplates) => {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(state));
};

export const listTemplates = (): TemplateRecord[] => {
  return readState().templates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const upsertTemplate = (template: TemplateRecord) => {
  const state = readState();
  const next = state.templates.filter((item) => item.id !== template.id);
  next.unshift(template);
  writeState({ templates: next });
};

export const deleteTemplate = (templateId: string) => {
  const state = readState();
  writeState({ templates: state.templates.filter((item) => item.id !== templateId) });
};

export const getTemplate = (templateId: string): TemplateRecord | undefined =>
  readState().templates.find((item) => item.id === templateId);
