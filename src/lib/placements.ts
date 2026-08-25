import type { OverlayRole, PageMetrics, Placement } from '../types';
import { makeId } from './files';

export const createDefaultPlacement = (role: OverlayRole, pageIndex: number, pageMetrics?: PageMetrics): Placement => {
  const isStamp = role === 'stamp';
  const width = isStamp ? 0.24 : 0.28;
  const height = isStamp ? 0.15 : 0.12;
  const topMargin = isStamp ? 0.14 : 0.68;
  const left = isStamp ? 0.70 : 0.62;
  const y = pageMetrics
    ? Math.min(1 - height - 0.05, topMargin)
    : topMargin;

  return {
    id: makeId(role),
    role,
    pageIndex,
    x: left,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
  };
};

export const clonePlacementForPage = (placement: Placement, pageIndex: number): Placement => ({
  ...placement,
  id: makeId(placement.role),
  pageIndex,
});

export const getPlacementLabel = (role: OverlayRole) => (role === 'stamp' ? 'Печать' : 'Подпись');
