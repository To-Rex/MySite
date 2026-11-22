import { describe, expect, it } from 'vitest'
import { WAVE, countAt, countDuration, waveDelay } from '@/lib/count'

/**
 * The GitHub section's numbers count to their values and its graph draws in
 * as a wave. Both are GitHub's own numbers arriving, so what has to hold is
 * that the arriving never shows a number that is not on the way there, and
 * always ends on the number itself.
 */

const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n)

describe('a count', () => {
  it('starts where it was told to and lands exactly on its number', () => {
    expect(countAt(0, 365, 0)).toBe(0)
    expect(countAt(0, 365, 1)).toBe(365)
    expect(countAt(0, 365, 7)).toBe(365)
    expect(countAt(0, 365, -1)).toBe(0)
    expect(countAt(0, 0, 0.5)).toBe(0)
    // Whatever the number was: a fraction is landed on too, and whole numbers lead up to it.
    expect(countAt(0, 12.5, 1)).toBe(12.5)
    expect(Number.isInteger(countAt(0, 12.5, 0.6))).toBe(true)
  })

  it('only ever climbs, in whole numbers, and never passes where it is going', () => {
    for (const to of [1, 7, 42, 365, 1284, 15_300]) {
      let last = 0
      for (const t of steps(600)) {
        const value = countAt(0, to, t)
        expect(Number.isInteger(value), `${to} at ${t}`).toBe(true)
        expect(value, `${to} at ${t}`).toBeGreaterThanOrEqual(last)
        expect(value, `${to} at ${t}`).toBeLessThanOrEqual(to)
        last = value
      }
      expect(last).toBe(to)
    }
  })

  it('counts back to a year instead of up from nought', () => {
    let last = 2026
    const seen = new Set<number>()
    for (const t of steps(600)) {
      const value = countAt(2026, 2021, t)
      expect(value).toBeLessThanOrEqual(last)
      expect(value).toBeGreaterThanOrEqual(2021)
      seen.add(value)
      last = value
    }
    expect(last).toBe(2021)
    expect([...seen]).toEqual([2026, 2025, 2024, 2023, 2022, 2021])
  })

  it('runs fast and settles slowly', () => {
    expect(countAt(0, 1000, 0.25)).toBeGreaterThan(500)
    expect(countAt(0, 1000, 0.5)).toBeGreaterThan(850)
    expect(countAt(0, 1000, 0.9)).toBeLessThan(1000)
  })

  it('does not leave a small number waiting on its last step', () => {
    const landsAt = (to: number) => steps(1000).find((t) => countAt(0, to, t) === to)!
    expect(landsAt(7)).toBeLessThan(0.7)
    expect(landsAt(7)).toBeLessThan(landsAt(42))
    expect(landsAt(42)).toBeLessThan(landsAt(365))
  })

  it('answers with a number whatever it is given', () => {
    expect(countAt(Number.NaN, 42, 0.5)).toBeGreaterThan(0)
    expect(countAt(0, Number.NaN, 0.5)).toBe(0)
    expect(countAt(0, Number.POSITIVE_INFINITY, 0.5)).toBe(0)
    expect(countAt(0, 42, Number.NaN)).toBe(0)
  })

  it('takes longer the further it has to go, by the size of the number and within bounds', () => {
    const lengths = [0, 7, 42, 365, 1284, 15_300, 2_000_000_000].map((to) => countDuration(0, to))
    for (const [i, length] of lengths.entries()) {
      expect(length).toBeGreaterThanOrEqual(0.5)
      expect(length).toBeLessThanOrEqual(2.4)
      if (i > 0) expect(length).toBeGreaterThanOrEqual(lengths[i - 1]!)
    }
    expect(countDuration(0, 7)).toBeLessThan(1)
    expect(countDuration(0, 365)).toBeGreaterThan(1.5)
    // The same either way round, and never NaN.
    expect(countDuration(2026, 2021)).toBe(countDuration(2021, 2026))
    expect(Number.isFinite(countDuration(Number.NaN, Number.NaN))).toBe(true)
  })
})

describe('the wave across the contribution graph', () => {
  it('starts at the oldest week and reaches the newest in the same time however many weeks there are', () => {
    for (const columns of [26, 53]) {
      expect(waveDelay(0, 0, columns)).toBe(0)
      expect(waveDelay(columns - 1, 0, columns)).toBe(WAVE.across)
    }
  })

  it('moves left to right, each cell a little after the one above it', () => {
    for (const columns of [26, 53]) {
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < 7; row++) {
          const delay = waveDelay(column, row, columns)
          expect(Number.isInteger(delay)).toBe(true)
          if (column > 0) expect(delay).toBeGreaterThan(waveDelay(column - 1, row, columns))
          if (row > 0) expect(delay).toBeGreaterThan(waveDelay(column, row - 1, columns))
        }
      }
    }
  })

  it('is a front that leans, not a line of columns: the bottom of one column starts after the top of the next few', () => {
    expect(waveDelay(0, 6, 53)).toBeGreaterThan(waveDelay(3, 0, 53))
    expect(waveDelay(0, 6, 53)).toBeLessThan(waveDelay(12, 0, 53))
  })

  it('still has an order with one week or none', () => {
    expect(waveDelay(0, 0, 1)).toBe(0)
    expect(waveDelay(0, 3, 1)).toBe(3 * WAVE.row)
    expect(waveDelay(0, 0, 0)).toBe(0)
    expect(waveDelay(-1, -1, 53)).toBe(0)
  })
})
