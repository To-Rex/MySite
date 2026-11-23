import { CARD_COUNT } from './evoTraffic'

/**
 * Every word and number the traffic draws, in one place: the number plates,
 * what a bus says on its front, the route cards in the minibuses' windscreens.
 * `evoCars.ts` draws these and nothing else, and the tests read this list for
 * anything that should not be on it — no maker's or model's name is.
 *
 * The plates have the country's layout — the region, a line, then letters and
 * figures, the flag and its two letters at the left — and numbers that are
 * nobody's. The buses' signs name two of the city's districts; the route
 * numbers on signs and cards are not taken from any timetable.
 */

export const PLATE_COUNT = 8

export interface PlateText {
  region: string
  number: string
}

/** A deterministic hash of two integers to [0, 1). */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** The letters a plate uses: the Latin ones that read the same everywhere. */
const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVXYZ'
/** The regions on them: the city's, mostly, and a few from the rest of the country. */
const REGIONS = ['01', '01', '01', '10', '01', '30', '01', '40'] as const

export function plateTexts(): PlateText[] {
  const out: PlateText[] = []
  for (let tile = 0; tile < PLATE_COUNT; tile++) {
    const letter = (salt: number) => LETTERS[Math.floor(hash(tile * 7 + salt, 3) * LETTERS.length)] ?? 'A'
    const digit = (salt: number) => String(Math.floor(hash(tile * 11 + salt, 5) * 10))
    // A private car's, mostly: a letter, three figures, two letters. The odd one is a firm's.
    const firm = tile % 4 === 3
    const number = firm ? `${digit(1)}${digit(2)}${digit(3)} ${letter(4)}${letter(5)}${letter(6)}` : `${letter(1)} ${digit(2)}${digit(3)}${digit(4)} ${letter(5)}${letter(6)}`
    out.push({ region: REGIONS[tile] ?? '01', number })
  }
  return out
}

/** The country's two letters, under the flag at the left of a plate. */
export const COUNTRY = 'UZ'

/** What a bus says on its front: a route number and where it is going. */
export const SIGN_TEXTS: readonly (readonly [string, string])[] = [
  ['19', 'CHORSU'],
  ['58', 'SERGELI'],
]

/** The numbers on the minibuses' route cards. */
export const CARD_TEXTS: readonly string[] = ['45', '103', '71', '29']
if (CARD_TEXTS.length < CARD_COUNT) throw new Error('a route card for every minibus route')

/** Everything above, as the strings that are drawn. */
export function carTexts(): string[] {
  return [...plateTexts().flatMap((plate) => [plate.region, plate.number]), COUNTRY, ...SIGN_TEXTS.flatMap(([route, to]) => [route, to, `${route}  ${to}`]), ...CARD_TEXTS]
}
