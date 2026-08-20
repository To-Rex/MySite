import type { BuildingId } from '@/i18n/types'

export interface BuildingArea {
  id: BuildingId
  /** A deterministic "signal" shape so the tiles feel alive without being random on every render. */
  signal: readonly number[]
}

export const buildingAreas: readonly BuildingArea[] = [
  { id: 'mobile', signal: [0.35, 0.6, 0.45, 0.8, 0.55, 0.9, 0.7, 0.95, 0.6, 0.85, 0.75, 1] },
  { id: 'offline', signal: [0.5, 0.4, 0.7, 0.5, 0.85, 0.6, 0.9, 0.65, 0.8, 0.95, 0.7, 0.9] },
  { id: 'devtools', signal: [0.2, 0.5, 0.35, 0.7, 0.4, 0.75, 0.6, 0.8, 0.5, 0.9, 0.85, 0.95] },
  { id: 'backend', signal: [0.6, 0.55, 0.75, 0.65, 0.8, 0.7, 0.9, 0.75, 0.85, 0.8, 0.95, 0.9] },
  { id: 'ai', signal: [0.15, 0.3, 0.5, 0.45, 0.7, 0.65, 0.85, 0.8, 0.9, 0.95, 0.9, 1] },
  { id: 'storage', signal: [0.4, 0.7, 0.5, 0.85, 0.6, 0.9, 0.7, 0.95, 0.8, 0.9, 0.95, 1] },
]
