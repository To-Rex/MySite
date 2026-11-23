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
  /**
   * For a plan made word by word (`planMorphByWord`): when the front reaches
   * the first letter of each word, and its last, and whether the word is one
   * that only goes. The words are those of whichever string has more of them.
   */
  words?: readonly (readonly [first: number, last: number, goes: boolean])[]
  /** Whether a letter in the air is to be about as wide as the one landing. */
  fitted?: boolean
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
  /** For a plan made word by word: how far along each word of the plan is. */
  words?: readonly WordPhase[]
}

/** A word of a plan made word by word: not yet reached by the front, changing, or landed — every letter of it what it will be, or gone. */
export type WordPhase = 0 | 1 | 2

/** The words of a text: what it is split into where it is set word by word. */
export const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean)

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

  return { from, to, slots, pool: poolOf(a, b), changes: slots.filter((slot) => slot.old !== slot.neu).length }
}

/** The letters shown while one is in the air: those of the string being landed in — or, if it has none, of the one being left. */
function poolOf(from: readonly string[], to: readonly string[]): string[] {
  const of = (text: readonly string[]) => [...new Set(text.filter(isLetter))]
  return of(to).length ? of(to) : of(from).length ? of(from) : ['·']
}

/**
 * The same, for text set in words that have to stay words: a heading, where
 * each word is laid out as a thing of its own and a letter that reached across
 * a space on its way would be two words fusing into one too long for its line.
 *
 * So each word turns into the word in its place, and the space between two
 * words is a space throughout. Where one string has more words than the other,
 * the ones left over come, or go, after the last word the two share. The ones
 * that come do so when the front gets there, like anything else. The ones that
 * go do not wait for it: they go as the words before them grow, a letter of
 * theirs at the instant a letter comes further up, so that the text is never
 * much longer than it was or will be and what would not fit on its lines never
 * has to. (If the words before them do not grow, there is room, and they wait
 * for the front.) A word that goes takes its space with its last letter, and
 * a word that comes brings it with its first.
 *
 * And the letters in the air are, where the text has them, about as wide as
 * the ones landing (`fitted`): a heading is not broken afresh on its way, so
 * what passes through a line should not be much wider than the line.
 *
 * Two strings that share fewer than two words are not set word against word:
 * one word becoming three, or three becoming one, is exactly a letter turning
 * into a space, and `planMorph` does that.
 */
export function planMorphByWord(from: string, to: string): MorphPlan {
  const pieces = (text: string) => [...text.matchAll(/\S+/g)].map((match) => ({ start: match.index, end: match.index + match[0].length }))
  const a = pieces(from)
  const b = pieces(to)
  const shared = Math.min(a.length, b.length)
  if (shared === 0 || (shared < 2 && a.length !== b.length)) return planMorph(from, to)

  // What is before the first word; word and gap by turns; the words only one string has, each after its gap; what is after the last.
  type Part = { plan: MorphPlan; word: number; gap?: boolean }
  const parts: Part[] = [{ plan: planMorph(from.slice(0, a[0]!.start), to.slice(0, b[0]!.start)), word: -1 }]
  for (let i = 0; i < shared; i++) {
    parts.push({ plan: planMorph(from.slice(a[i]!.start, a[i]!.end), to.slice(b[i]!.start, b[i]!.end)), word: i })
    if (i < shared - 1) parts.push({ plan: planMorph(from.slice(a[i]!.end, a[i + 1]!.start), to.slice(b[i]!.end, b[i + 1]!.start)), word: -1 })
  }
  const goes = a.length > b.length
  const more = goes ? { text: from, words: a } : { text: to, words: b }
  const alone = (text: string) => (goes ? planMorph(text, '') : planMorph('', text))
  for (let i = shared; i < more.words.length; i++) {
    parts.push({ plan: alone(more.text.slice(more.words[i - 1]!.end, more.words[i]!.start)), word: i, gap: true })
    parts.push({ plan: alone(more.text.slice(more.words[i]!.start, more.words[i]!.end)), word: i })
  }
  parts.push({ plan: planMorph(from.slice(a[a.length - 1]!.end), to.slice(b[b.length - 1]!.end)), word: -1 })

  // One string again: each part keeps the order of its own places, over its own stretch of the whole.
  const total = parts.reduce((sum, part) => sum + part.plan.slots.length, 0)
  const last = Math.max(1, total - 1)
  const slots: Slot[] = []
  const each: { letters: Slot[]; gap: Slot[] }[] = []
  let gap: Slot[] = []
  for (const part of parts) {
    const offset = slots.length
    const within = Math.max(1, part.plan.slots.length - 1)
    const placed = part.plan.slots.map((slot): Slot => ({ old: slot.old, neu: slot.neu, at: (offset + slot.at * within) / last }))
    slots.push(...placed)
    if (part.gap) gap = placed
    else if (part.word >= 0) each[part.word] = { letters: placed, gap: part.word >= shared ? gap : [] }
  }

  // Words that go: their letters go as letters come in the words before them, spread over all of those.
  if (goes) {
    const lone = each.slice(shared).flatMap((word) => word.letters)
    const coming = each
      .slice(0, shared)
      .flatMap((word) => word.letters)
      .filter((slot) => !slot.old && slot.neu)
      .sort((p, q) => p.at - q.at)
    if (coming.length) lone.forEach((slot, i) => (slot.at = coming[Math.floor((i * coming.length) / lone.length)]!.at))
  }

  const words = each.map(({ letters: own, gap: before }, word): [number, number, boolean] => {
    const first = Math.min(...own.map((slot) => slot.at))
    const end = Math.max(...own.map((slot) => slot.at))
    if (word >= shared) for (const slot of before) slot.at = goes ? end : first
    return [first, end, goes && word >= shared]
  })
  return { from, to, slots, pool: poolOf(letters(from), letters(to)), changes: slots.filter((slot) => slot.old !== slot.neu).length, words, fitted: true }
}

/** What was found, a step having been laid out, to need doing ahead of the front or behind it (`linesOnTheWay`). */
export interface Mended {
  /** Words to drop to a line of their own now, though the front has not reached them. */
  hurried: readonly number[]
  /** Words to keep at the head of a line for now, though the front has left them behind. */
  held: readonly number[]
}

/**
 * Which words begin a line while text set in words is on its way from one
 * layout to another — a heading whose translation breaks differently.
 *
 * `was` and `will` are the words, by number, that begin a line before and
 * after (the first never counts), and `words` how far along each is
 * (`MorphFrame`). A word only one of the two texts has is numbered after the
 * ones they share, as in the plan; `stay` is how many words the new text has,
 * where it has fewer: the ones from there on only go.
 *
 * Left to itself the text would be broken afresh at every step, and a line
 * would come and go as the words either side of it changed. So each break
 * moves once, when the front is there: a word drops to a line of its own as
 * the front reaches it, and a word comes up to the line before it once it has
 * landed and is the size it will be. And a break that goes is paired with the
 * nearest one that comes, the two happening together — so the number of lines
 * moves towards what it will be and never away from it, and what is below the
 * text moves once, or not at all.
 *
 * The pair happens when either of the two would have: the word that drops
 * reached, or the word that comes up landed. A line of words that only go has
 * nothing to come up: its break is done with when the last of them is gone,
 * and until then they keep the line they had.
 *
 * None of that knows how wide anything is, and the text breaks nowhere but
 * here. `mended` is what looking at a step on the page found: a word to drop
 * ahead of the front, because the line it is to leave had outgrown its place
 * (`hurried`), or one to keep where it was, because the line it came up to
 * had no room for it yet (`held`) — it comes up when every word of the two
 * lines has landed, which is when they are the line they will be. Only a word
 * that was going to drop can be hurried and only one that began a line can be
 * held: this changes when, never what.
 */
export function linesOnTheWay(
  was: readonly number[],
  will: readonly number[],
  words: readonly WordPhase[],
  stay = Infinity,
  { hurried, held }: Mended = { hurried: [], held: [] },
): number[] {
  const before = new Set(was)
  const after = new Set(will)
  const all = [...new Set([...was, ...will])].filter((word) => word > 0).sort((p, q) => p - q)
  type Change = { word: number; comes: boolean }
  const changes: Change[] = all.filter((word) => before.has(word) !== after.has(word)).map((word) => ({ word, comes: after.has(word) }))
  const phase = (word: number) => words[word] ?? 0
  const due = ({ word, comes }: Change) => {
    if (comes) return phase(word) >= 1 || hurried.includes(word)
    if (word < stay) return phase(word) === 2
    // The rest of the line it began: every word up to the next that began one.
    for (let other = word; other < words.length && (other === word || !before.has(other)); other++) if (phase(other) < 2) return false
    return true
  }
  /** Held, and the two lines it stands between — from the break before it to the break after — not yet what they will be. */
  const kept = (word: number) => {
    if (!held.includes(word)) return false
    const at = all.indexOf(word)
    for (let other = all[at - 1] ?? 0; other < (all[at + 1] ?? words.length); other++) if (phase(other) < 2) return true
    return false
  }

  const done = new Set<number>()
  const settle = (change: Change) => {
    if (change.comes || !kept(change.word)) done.add(change.word)
  }
  const waiting: Change[] = []
  for (const change of changes) {
    const other = waiting[waiting.length - 1]
    if (other && other.comes !== change.comes) {
      waiting.pop()
      if (due(change) || due(other)) {
        settle(change)
        settle(other)
      }
    } else waiting.push(change)
  }
  for (const change of waiting) if (due(change)) settle(change)

  return all.filter((word) => (done.has(word) ? after : before).has(word))
}

/** The two layouts such a text is on its way between: the words that begin a line in each, and how many words each has. */
export interface Way {
  was: readonly number[]
  will: readonly number[]
  from: number
  to: number
}

/**
 * Which word of the plan each word of a step is. They are the same until the
 * old text has more words than the new: those go in order, so of them the ones
 * still there are the last.
 */
export function wordsOnTheWay(way: Way, live: number): number[] {
  const shared = Math.min(way.from, way.to)
  const gone = Math.max(0, way.from - Math.max(live, shared))
  return Array.from({ length: live }, (_, i) => (i < shared ? i : i + gone))
}

/**
 * For each word of a step on the way, whether it begins a line: the breaks
 * such a text is given while it changes, in place of the ones it would fall
 * into. Left to fall, it is broken afresh at every step by the widths of the
 * letters passing through it — which are of every width — and a line a hair
 * under full breaks and mends from one step to the next, taking everything
 * below it up and down.
 *
 * For a plan made word by word these are `linesOnTheWay`. For any other, the
 * words are not the same words from one step to the next, and all that is
 * known is how the text lay and how it will: it lies as it did for as long as
 * it has as many words as it had, and as it will once it has as many as it
 * will have. Null in between, and the text falls as it will.
 */
export function beginsOnTheWay(way: Way, step: MorphFrame, mended?: Mended): boolean[] | null {
  const live = wordsOf(step.text).length
  if (!step.words) {
    const lines = live === way.from ? way.was : live === way.to ? way.will : null
    return lines && Array.from({ length: live }, (_, i) => lines.includes(i))
  }
  const lines = linesOnTheWay(way.was, way.will, step.words, way.to, mended)
  let above = -1
  return wordsOnTheWay(way, live).map((word, i) => {
    // A line that began with a word since gone begins with the next one still there.
    const begins = i > 0 && lines.some((line) => line > above && line <= word)
    above = word
    return begins
  })
}

/** How often the letter shown for one in the air changes, over the whole of a change. */
const FLICKERS = 16

/** Letters and marks that take little room on a line in most faces, and letters that take a lot: the rest are in between. */
const NARROW = /[ijlrtfIJ1.,:;!'’‘`ʻ|іїј]/u
const WIDE = /[mwMWжмшщыюфЖМШЩЫЮФД—@%]/u
const girth = (char: string) => (NARROW.test(char) ? 0 : WIDE.test(char) ? 2 : 1)

/** The letter shown in a place while its own is in the air: of the same kind as the one landing, and the same case. */
function inTheAir(plan: MorphPlan, index: number, step: number, landing: string): string {
  if (isDigit(landing)) return String(mix(index, step) % 10)
  // Where it matters, of about the same width too — if the text has any letters that are.
  const alike = plan.fitted ? plan.pool.filter((char) => girth(char) === girth(landing)) : []
  const pool = alike.length ? alike : plan.pool
  const glyph = pool[mix(index, step) % pool.length]!
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
  if (t === 0 || t < 0) return { text: plan.from, hot: [], ...(plan.words && { words: plan.words.map(() => 0 as const) }) }
  if (!(t < 1)) return { text: plan.to, hot: [], ...(plan.words && { words: plan.words.map(() => 2 as const) }) }
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
  if (!plan.words) return { text, hot }
  // A letter that goes is gone the moment the front is there: a word that only goes has landed with its last.
  const words = plan.words.map(([first, last, goes]): WordPhase => (t >= last * (1 - air) + (goes ? 0 : air) ? 2 : t >= first * (1 - air) ? 1 : 0))
  return { text, hot, words }
}

/** One string on its way to another, in one call: for a test, or a single frame. */
export function morphText(from: string, to: string, t: number, timing?: MorphTiming): string {
  return morphAt(planMorph(from, to), t, timing).text
}
