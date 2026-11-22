import { clamp, clamp01 } from './scroll'

/**
 * The number a count shows part of the way through: `t` is 0 where it starts
 * and 1 where it lands. It runs fast and settles slowly, shows whole numbers on
 * the way, never passes the number it is counting to and never steps back —
 * and at the end it is exactly that number, whatever it was.
 *
 * It counts down as readily as up: a year someone joined is counted back to,
 * not up from nought.
 */
export function countAt(from: number, to: number, t: number): number {
  if (!Number.isFinite(to)) return 0
  const start = Number.isFinite(from) ? from : 0
  const p = clamp01(t)
  if (p >= 1) return to
  const value = start + (to - start) * (1 - Math.pow(1 - p, 3))
  // Rounded, so the last step is not the one that takes longest: a count to seven is on seven well before a count to a thousand lands.
  return to >= start ? Math.min(to, Math.round(value)) : Math.max(to, Math.round(value))
}

/**
 * How long a count takes, in seconds: longer the further it has to go, but by
 * the size of the number, not the number — seven is there in under a second,
 * and a hundred thousand does not take an hour.
 */
export function countDuration(from: number, to: number): number {
  const distance = Math.abs((Number.isFinite(to) ? to : 0) - (Number.isFinite(from) ? from : 0))
  return clamp(0.5 + Math.log10(distance + 1) * 0.46, 0.5, 2.4)
}

/** How long a wave takes to cross its row, how far behind the one above each row starts, and how long one cell takes to rise, in milliseconds. */
export const WAVE = { across: 900, row: 22, cell: 620 } as const

/** When the cell at a column and a row joins a wave that crosses `columns` columns in all. */
export function waveDelay(column: number, row: number, columns: number): number {
  const step = columns > 1 ? WAVE.across / (columns - 1) : 0
  return Math.round(Math.max(0, column) * step + Math.max(0, row) * WAVE.row)
}
