import { morphAt, planMorph, planMorphByWord, type MorphFrame, type MorphPlan } from './morph'

/**
 * A change of language, shown: every piece of text on screen turns into its
 * translation letter by letter (`morph.ts` says how), top of the screen first.
 *
 * React is not asked. It has already put the new text in the page by the time
 * this runs; this writes the old text back into the same text nodes before the
 * browser paints, walks each to the new text over the next second, and ends by
 * writing exactly what React wrote. React never reads the page back, so as
 * long as that last write happens it cannot tell — and if React writes to a
 * node again first, with something newer, this finds a value it did not put
 * there and lets go of that node.
 *
 * A heading split into masked words is the one thing that cannot be written
 * into like that: how many text nodes it is depends on what it says, and they
 * are React's to make and remove. It is a `Writer` instead: it is told to go
 * back to what it said, and then what to say at each step, and lays that out
 * itself (`useWriter.ts`).
 */

/** Whether this browser, for this reader, is one to do it in. */
export function canMorph(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || typeof window.requestAnimationFrame !== 'function') return false
  if (typeof document.createTreeWalker !== 'function') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Text that is never rewritten on its way anywhere, only replaced:
 * - what is not text on the page at all (scripts, form controls, drawings);
 * - what a screen reader is read aloud as it changes, or is its alone;
 * - what is under an open overlay (`inert`), where nobody would see it;
 * - anything that asks to be left out with `data-no-morph`;
 * - and what a writer lays out (`data-morph="own"`): it is told, not written into.
 */
const LEFT_ALONE = [
  'script',
  'style',
  'noscript',
  'template',
  'textarea',
  'input',
  'select',
  'option',
  'svg',
  'canvas',
  '[contenteditable]:not([contenteditable="false"])',
  '[inert]',
  '[aria-live]:not([aria-live="off"])',
  '[role="status"]',
  '[role="alert"]',
  '[role="log"]',
  '[role="timer"]',
  '[role="marquee"]',
  '.sr-only',
  '.sr-only-focusable',
  '[data-no-morph]',
  '[data-morph="own"]',
].join(',')

/** How far past the edges of the screen text still counts as on it, in screen heights. */
const MARGIN = 0.3
/** No more than this is ever animated at once: a page of text, not a book. */
const MOST = { nodes: 220, letters: 12_000, ranges: 400 }
/** Milliseconds between rewrites: thirty a second is a flicker, sixty is the same flicker at twice the layout. */
const BEAT = 30
/** Set on <html> for as long as a change is on its way, for styles and for tests. */
export const MORPHING = 'data-lang-morph'
/** The name of the highlight drawn over the letters that are changing (`::highlight(lang-morph)`). */
const LIT = 'lang-morph'

export interface Captured {
  text: string
  /** Where on the screen it was, in pixels: the change starts at the top and works down. */
  top: number
  left: number
  /** For a writer: how it lay. */
  lay?: Lay
}

/** How text set in words lies: which of its words begin a line (the first never counts), and how wide its widest line is, in pixels. */
export interface Lay {
  lines: readonly number[]
  widest: number
}

type Place = (element: Element) => { top: number; left: number } | null

/** The letters changing or just changed, as [start, end) in the text: what `morphAt` calls hot. */
type Hot = readonly (readonly [number, number])[]

/**
 * Text that lays its own letters out, and so is told what to say rather than
 * written into. `useWriter` makes one of whatever it is given.
 */
export interface Writer {
  /** Where it is in the page, once it is there. */
  element(): Element | null
  /** Whether a reader is being shown what it says: a heading still behind its masks is not on its way anywhere. */
  shown(): boolean
  /** What it says now, and what it has been asked to say: the same thing, except while a change is on its way. */
  said(): string
  asked(): string
  /** How it lies now. */
  lay(): Lay
  /**
   * Goes back to saying what it said — `text`, lying as it did (`lay`) —
   * having first looked at how what it has been asked to say lies. Called once
   * React has written the new text and before the browser has painted it.
   */
  leave(text: string, lay: Lay): void
  /** Says this, now: a step on the way. Answers with where in the page the letters of `hot` ended up. */
  say(step: MorphFrame, hot: Hot): Range[]
  /** Goes back to saying what it was asked to, laid out as it falls. */
  rest(): void
}

const writers = new Set<Writer>()

/** Puts a writer among what a change of language is shown on. Returns the way to take it out again. */
export function addWriter(writer: Writer): () => void {
  writers.add(writer)
  return () => void writers.delete(writer)
}

/** Everything a reader could see when the language was changed, and what each piece of it said. */
export type Leaving = Map<Text | Writer, Captured>

const isText = (on: Text | Writer): on is Text => (on as Text).nodeType === 3

/** Where an element is, if it is somewhere a reader could see it. */
const onScreen: Place = (element) => {
  if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return null
  const box = element.getBoundingClientRect()
  if (!(box.width > 0 && box.height > 0)) return null
  const margin = window.innerHeight * MARGIN
  if (box.bottom < -margin || box.top > window.innerHeight + margin || box.right < 0 || box.left > window.innerWidth) return null
  return { top: box.top, left: box.left }
}

/**
 * Every piece of text a reader can see, as it is now. Taken just before the
 * language changes, it is what each of them will be changing *from*.
 */
export function captureText(root: Node = document.body, place: Place = onScreen): Leaving {
  const found: Leaving = new Map()
  const placed = new Map<Element, ReturnType<Place>>()
  let letters = 0
  // The writers first: a handful of headings, and the largest text there is.
  for (const writer of writers) {
    const element = writer.element()
    if (!element || !root.contains(element) || !writer.shown() || element.parentElement?.closest(LEFT_ALONE)) continue
    const where = place(element)
    const text = writer.said()
    if (!where || !text.trim()) continue
    found.set(writer, { text, top: where.top, left: where.left, lay: writer.lay() })
    letters += text.length
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    // A whole subtree is passed over at its root, not asked about node by node.
    acceptNode: (node) =>
      node.nodeType !== Node.ELEMENT_NODE ? NodeFilter.FILTER_ACCEPT : (node as Element).matches(LEFT_ALONE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP,
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    const parent = text.parentElement
    if (!parent || !text.data.trim()) continue
    let where = placed.get(parent)
    if (where === undefined) {
      where = place(parent)
      placed.set(parent, where)
    }
    if (!where) continue
    found.set(text, { text: text.data, top: where.top, left: where.left })
    letters += text.data.length
    if (found.size >= MOST.nodes || letters >= MOST.letters) break
  }
  return found
}

const SPACE = /\s/

/**
 * Where letters of `text` are in the page, for an element that says `text` in
 * however many text nodes, with the spaces between its words collapsed, moved
 * or left out. So the letters are counted without the spaces: the nth letter
 * of the text is the nth letter under the element, wherever the words break.
 */
export function rangesWithin(root: Element, text: string, hot: Hot): Range[] {
  if (!hot.length || typeof document.createRange !== 'function') return []
  const inked = (until: number) => {
    let count = 0
    for (let i = 0; i < until && i < text.length; i++) if (!SPACE.test(text[i]!)) count++
    return count
  }
  const spans = hot.map(([from, to]) => [inked(from), inked(to)] as const).filter(([from, to]) => to > from)
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let seen = 0
  let next = 0
  let open: Range | null = null
  for (let node = walker.nextNode() as Text | null; node && next < spans.length; node = walker.nextNode() as Text | null) {
    const data = node.data
    for (let i = 0; i < data.length && next < spans.length; i++) {
      if (SPACE.test(data[i]!)) continue
      const [from, to] = spans[next]!
      if (seen === from) {
        open = document.createRange()
        open.setStart(node, i)
      }
      seen++
      if (open && seen === to) {
        open.setEnd(node, i + 1)
        ranges.push(open)
        open = null
        next++
      }
    }
  }
  return ranges
}

interface Job {
  on: Text | Writer
  plan: MorphPlan
  /** Milliseconds after the change began that this one starts, and how long it takes. */
  start: number
  length: number
  window: number
  glow: number
  /** What this wrote last. Anything else found there was written by someone else. */
  last: string
  done: boolean
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

interface Highlights {
  set(name: string, highlight: unknown): void
  delete(name: string): boolean
}

let styled = false

/**
 * How a letter on its way is drawn: towards the accent from whatever colour
 * the text is, so it shows on a dark page and on a light button alike.
 *
 * The rule is added here, once, and is not in the stylesheet: the optimiser
 * that minifies it does not know `::highlight()` and the build must stay free
 * of warnings. A constructed sheet is not an inline style, and the policy the
 * site is served with allows those anyway.
 */
function styleTheLit(): void {
  if (styled) return
  styled = true
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`::highlight(${LIT}) { color: color-mix(in oklab, currentColor 40%, var(--accent)); }`)
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  } catch {
    // No colour for them, then. The letters still change.
  }
}

/** The browser's registry of highlights and a way to make one, where it has them: drawing over text without touching it. */
function highlights(): { registry: Highlights; make: (ranges: Range[]) => unknown } | null {
  const scope = globalThis as { CSS?: { highlights?: Highlights }; Highlight?: new (...ranges: Range[]) => unknown }
  const registry = scope.CSS?.highlights
  const Highlight = scope.Highlight
  if (!registry || typeof Highlight !== 'function' || typeof document.createRange !== 'function') return null
  styleTheLit()
  return { registry, make: (ranges) => new Highlight(...ranges) }
}

/** What it says now: null once it has left the page. */
const said = (on: Text | Writer): string | null => (isText(on) ? (on.isConnected ? on.data : null) : on.element()?.isConnected ? on.said() : null)

/** Has it say what a moment of the change has it say, and answers with where in the page the letters of `hot` are. */
function write(on: Text | Writer, step: MorphFrame, hot: Hot): Range[] {
  if (!isText(on)) return on.say(step, hot)
  const { text } = step
  if (on.data !== text) on.data = text
  return hot.map(([from, to]) => {
    const range = document.createRange()
    range.setStart(on, from)
    range.setEnd(on, to)
    return range
  })
}

/**
 * Plays the change for everything that was captured and has since been given
 * different text. `flip` is for two spellings of one language: each letter
 * turns over at once instead of spending a moment in the air.
 *
 * Returns a function that ends it at once, leaving every node it still holds
 * with the text it was heading for.
 */
export function playMorph(captured: Readonly<Leaving>, { flip = false }: { flip?: boolean } = {}): () => void {
  const height = Math.max(1, window.innerHeight)
  const width = Math.max(1, window.innerWidth)
  const jobs: Job[] = []
  for (const [on, was] of captured) {
    // What it is to say now: what React wrote into the node, or what the writer has been asked for.
    const now = isText(on) ? (on.isConnected ? on.data : null) : on.element()?.isConnected ? on.asked() : null
    // A writer's words are laid out one by one, and stay words on the way.
    const plan = now === null || now === was.text ? null : isText(on) ? planMorph(was.text, now) : planMorphByWord(was.text, now)
    if (!plan?.changes) continue
    const length = flip ? clamp(360 + plan.changes * 16, 420, 900) : clamp(440 + plan.changes * 9, 500, 1050)
    jobs.push({
      on,
      plan,
      start: clamp(was.top / height, 0, 1) * 240 + clamp(was.left / width, 0, 1) * 70,
      length,
      window: flip ? 0 : clamp(170 / length, 0.12, 0.4),
      glow: 260 / length,
      last: was.text,
      done: false,
    })
    // Back to what it said, before the browser has painted what it says now.
    if (isText(on)) on.data = was.text
    else on.leave(was.text, was.lay ?? { lines: [], widest: 0 })
  }
  if (!jobs.length) return () => {}

  const lit = highlights()
  const root = document.documentElement
  root.setAttribute(MORPHING, '')
  // Half-changed text is not for reading: a screen reader waits for the region to settle.
  document.body.setAttribute('aria-busy', 'true')

  const began = performance.now()
  let frame = 0
  let written = -Infinity
  let over = false

  const finish = () => {
    if (over) return
    over = true
    cancelAnimationFrame(frame)
    lit?.registry.delete(LIT)
    root.removeAttribute(MORPHING)
    document.body.removeAttribute('aria-busy')
  }

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick)
    if (now - written < BEAT) return
    written = now
    const ranges: Range[] = []
    let live = 0
    for (const job of jobs) {
      if (job.done) continue
      // Gone, or rewritten by someone else since — React, with something newer. It is theirs.
      if (said(job.on) !== job.last) {
        job.done = true
        continue
      }
      const t = (now - began - job.start) / job.length
      const moment = morphAt(job.plan, t, job)
      const landed = t >= 1
      const drawn = write(job.on, moment, lit && !landed ? moment.hot : [])
      job.last = moment.text
      if (landed) {
        job.done = true
        continue
      }
      live++
      for (const range of drawn) {
        if (ranges.length >= MOST.ranges) break
        ranges.push(range)
      }
    }
    if (lit) {
      if (ranges.length) lit.registry.set(LIT, lit.make(ranges))
      else lit.registry.delete(LIT)
    }
    if (!live) finish()
  }
  frame = requestAnimationFrame(tick)

  return () => {
    for (const job of jobs) {
      if (job.done) continue
      job.done = true
      if (said(job.on) !== job.last) continue
      if (isText(job.on)) job.on.data = job.plan.to
      else job.on.rest()
    }
    finish()
  }
}
