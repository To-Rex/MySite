/**
 * One string turning into another, letter by letter — what a change of
 * language looks like on the page. Pure: no DOM, no React, no clock. A plan is
 * made once for a pair of strings, and `morphAt` says what is written at any
 * moment of the change.
 *
 * Two things decide how it looks.
 *
 * What the two strings share holds still. For the two Uzbek alphabets that is
 * nearly everything: the strings are aligned letter for letter, and only the
 * four spellings that differ change, each at once — "sh" is "ş" the moment the
 * change reaches it. Any two strings that close are aligned the same way. For
 * two that are not — a sentence and its translation — whatever is the same at
 * either end or in the same place holds, and the rest is replaced position by
 * position.
 *
 * The change runs through the string as a front, from its first letter to its
 * last. A letter the front has reached is in the air for a moment — shown as
 * some other letter of the language it is landing in — and then it is the new
 * one. The string never gets longer and then shorter, or the other way round:
 * a letter that goes and a letter that comes do so at the same instant.
 */

/** One place in the string as it changes: a letter that stays, turns into another, goes or comes. */
interface Slot {
  /** What is there before (empty for a letter that comes) and after (empty for one that goes). */
  old: string
  neu: string
  /** When the front reaches it: 0 at the start of the string, 1 at its end. */
  at: number
}

export interface MorphPlan {
  from: string
  to: string
  slots: readonly Slot[]
  /** The letters shown while one is in the air: those of the string being landed in. */
  pool: readonly string[]
  /** How many places change at all. */
  changes: number
}

export interface MorphTiming {
  /** How long a letter is in the air, as a part of the whole change. 0 turns each letter over at once. */
  window?: number
  /** How long after it changed a letter still counts as just changed, as a part of the whole change. */
  glow?: number
}

export interface MorphFrame {
  text: string
  /** The letters changing or just changed, as [start, end) in UTF-16 units of `text`: what a highlight is drawn over. */
  hot: readonly (readonly [number, number])[]
}

const letters = (text: string): string[] => Array.from(text)

const isSpace = (char: string) => char.trim() === ''
const isLetter = (char: string) => /\p{L}/u.test(char)
const isDigit = (char: string) => /\p{Nd}/u.test(char)

/** A small integer hash: the same letters in the air on every run, with no pattern to them. */
function mix(a: number, b: number): number {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

type Edit = readonly [old: string, neu: string]

/**
 * A letter without its marks or its case: what "ş" and "S" have in common.
 * Two letters with the same base are one letter changing, not one going and
 * another coming — which is what tells "sh → ş" apart from "s → ?, h → ş".
 */
const base = (char: string): string => (char.normalize('NFD')[0] ?? char).toLowerCase()

/**
 * The shortest edit script from one run of letters to another (Myers), as
 * pairs: [a, b] for a letter that stays or only changes its marks, [a, ''] for
 * one removed, ['', b] for one added. Gives up — null — once it would take
 * more than `limit` edits, which is how two strings are found to be too
 * different to be worth aligning.
 */
function align(a: readonly string[], b: readonly string[], limit: number): Edit[] | null {
  const n = a.length
  const m = b.length
  const keyA = a.map(base)
  const keyB = b.map(base)
  const max = Math.min(limit, n + m)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && keyA[x] === keyB[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return walkBack(trace, a, b, d, offset)
    }
  }
  return null
}

function walkBack(trace: readonly Int32Array[], a: readonly string[], b: readonly string[], edits: number, offset: number): Edit[] {
  const out: Edit[] = []
  let x = a.length
  let y = b.length
  for (let d = edits; d >= 0; d--) {
    const v = trace[d]!
    const k = x - y
    const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
    const previousK = down ? k + 1 : k - 1
    const previousX = d === 0 ? 0 : v[offset + previousK]!
    const previousY = d === 0 ? 0 : previousX - previousK
    while (x > previousX && y > previousY) {
      x--
      y--
      out.push([a[x]!, b[y]!])
    }
    if (d === 0) break
    if (down) {
      y--
      out.push(['', b[y]!])
    } else {
      x--
      out.push([a[x]!, ''])
    }
  }
  return out.reverse()
}

/** A change of no more places than this happens all at once: a digraph becoming one letter is one event, not two. */
const ATOM = 3

/** How many edits for each letter of the longer string still count as the same text, respelt. */
const NEAR = 0.6

/** How to get from one string to another. Make it once for a pair; ask `morphAt` for each moment. */
export function planMorph(from: string, to: string): MorphPlan {
  const a = letters(from)
  const b = letters(to)

  // What the two share at either end holds still whatever else happens.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)

  // The middle: aligned if the two are the same text or nearly; otherwise one
  // run replaced by another, a letter for a letter for as far as both go. The
  // two Uzbek alphabets always pass: a digraph that becomes one letter costs
  // one edit for two letters, and the bar is six for ten.
  const longest = Math.max(midA.length, midB.length)
  const aligned = align(midA, midB, Math.floor(longest * NEAR))
  const edits = aligned ?? Array.from({ length: longest }, (_, i): Edit => [midA[i] ?? '', midB[i] ?? ''])

  // Each run of changes between two letters that stay is one small event, or
  // several: a letter changing its marks begins a new one and takes with it
  // whatever goes or comes after it. "choʻ" → "çö" is two — ch → ç, oʻ → ö.
  type Draft = { old: string; neu: string; atom: number }
  const drafts: Draft[] = a.slice(0, head).map((char) => ({ old: char, neu: char, atom: -1 }))
  let atom = -1
  let changing = false
  for (const [old, neu] of edits) {
    if (old === neu) {
      changing = false
      drafts.push({ old, neu, atom: -1 })
      continue
    }
    if (!changing || (old && neu)) atom++
    changing = true
    drafts.push({ old, neu, atom: aligned ? atom : -1 })
  }
  for (const char of a.slice(a.length - tail)) drafts.push({ old: char, neu: char, atom: -1 })
  // Only a small change happens all at once; a long one has a front of its own.
  const size = new Map<number, number>()
  for (const draft of drafts) if (draft.atom >= 0) size.set(draft.atom, (size.get(draft.atom) ?? 0) + 1)
  for (const draft of drafts) if (draft.atom >= 0 && size.get(draft.atom)! > ATOM) draft.atom = -1

  // When the front reaches each place: by where it is in the string. A small
  // change is reached all at once, at the place where it begins.
  const last = Math.max(1, drafts.length - 1)
  const started = new Map<number, number>()
  const slots: Slot[] = drafts.map((draft, i) => {
    let at = i / last
    if (draft.atom >= 0) {
      if (!started.has(draft.atom)) started.set(draft.atom, at)
      at = started.get(draft.atom)!
    }
    return { old: draft.old, neu: draft.neu, at }
  })

  // A letter that goes and a letter that comes do so together, so the string
  // only ever gets longer, or only ever shorter. Pair them off in the order the
  // front meets them; whichever kind is left over is the way the length moves.
  const going = slots.filter((slot) => slot.old && !slot.neu).sort((p, q) => p.at - q.at)
  const coming = slots.filter((slot) => !slot.old && slot.neu).sort((p, q) => p.at - q.at)
  for (let i = 0; i < Math.min(going.length, coming.length); i++) going[i]!.at = coming[i]!.at

  const pool = (text: readonly string[]) => [...new Set(text.filter(isLetter))]
  return {
    from,
    to,
    slots,
    pool: pool(b).length ? pool(b) : pool(a).length ? pool(a) : ['·'],
    changes: slots.filter((slot) => slot.old !== slot.neu).length,
  }
}

/** How often the letter shown for one in the air changes, over the whole of a change. */
const FLICKERS = 16

/** The letter shown in a place while its own is in the air: of the same kind as the one landing, and the same case. */
function inTheAir(plan: MorphPlan, index: number, step: number, landing: string): string {
  if (isDigit(landing)) return String(mix(index, step) % 10)
  const glyph = plan.pool[mix(index, step) % plan.pool.length]!
  if (!isLetter(landing)) return glyph
  const cased = landing === landing.toUpperCase() && landing !== landing.toLowerCase() ? glyph.toUpperCase() : glyph.toLowerCase()
  // "ß" in capitals is two letters; a place holds one.
  return letters(cased).length === 1 ? cased : glyph
}

/**
 * What is written at a moment of the change: `t` is 0 before anything has
 * moved and 1 when it is over. At either end the answer is the string itself,
 * exactly; anything that is not a moment — NaN — is the end.
 */
export function morphAt(plan: MorphPlan, t: number, timing: MorphTiming = {}): MorphFrame {
  if (!(t > 0)) return { text: t === 0 || t < 0 ? plan.from : plan.to, hot: [] }
  if (t >= 1) return { text: plan.to, hot: [] }
  const air = Math.min(0.9, Math.max(0, timing.window ?? 0.3))
  const glow = Math.max(air, timing.glow ?? 0)
  const step = Math.floor(t * FLICKERS)
  let text = ''
  const hot: [number, number][] = []
  plan.slots.forEach((slot, i) => {
    if (slot.old === slot.neu) {
      text += slot.old
      return
    }
    // The front crosses the string in the time left once the last letter has had its turn in the air.
    const reached = slot.at * (1 - air)
    let shown: string
    if (t < reached) shown = slot.old
    else if (!slot.neu) shown = ''
    else if (t >= reached + air || isSpace(slot.neu)) shown = slot.neu
    else shown = inTheAir(plan, i, step, slot.neu)
    if (shown && t >= reached && t < reached + glow && !isSpace(shown)) {
      const tip = hot[hot.length - 1]
      if (tip && tip[1] === text.length) tip[1] = text.length + shown.length
      else hot.push([text.length, text.length + shown.length])
    }
    text += shown
  })
  return { text, hot }
}

/** One string on its way to another, in one call: for a test, or a single frame. */
export function morphText(from: string, to: string, t: number, timing?: MorphTiming): string {
  return morphAt(planMorph(from, to), t, timing).text
}
