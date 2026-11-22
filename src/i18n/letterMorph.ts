import { morphAt, planMorph, type MorphPlan } from './morph'

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
 * - and anything that asks to be left out with `data-no-morph`.
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
}

type Place = (element: Element) => { top: number; left: number } | null

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
export function captureText(root: Node = document.body, place: Place = onScreen): Map<Text, Captured> {
  const found = new Map<Text, Captured>()
  const placed = new Map<Element, ReturnType<Place>>()
  let letters = 0
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

interface Job {
  node: Text
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

/**
 * Plays the change for everything that was captured and has since been given
 * different text. `flip` is for two spellings of one language: each letter
 * turns over at once instead of spending a moment in the air.
 *
 * Returns a function that ends it at once, leaving every node it still holds
 * with the text it was heading for.
 */
export function playMorph(captured: ReadonlyMap<Text, Captured>, { flip = false }: { flip?: boolean } = {}): () => void {
  const height = Math.max(1, window.innerHeight)
  const width = Math.max(1, window.innerWidth)
  const jobs: Job[] = []
  for (const [node, was] of captured) {
    if (!node.isConnected || node.data === was.text) continue
    const plan = planMorph(was.text, node.data)
    if (!plan.changes) continue
    const length = flip ? clamp(360 + plan.changes * 16, 420, 900) : clamp(440 + plan.changes * 9, 500, 1050)
    jobs.push({
      node,
      plan,
      start: clamp(was.top / height, 0, 1) * 240 + clamp(was.left / width, 0, 1) * 70,
      length,
      window: flip ? 0 : clamp(170 / length, 0.12, 0.4),
      glow: 260 / length,
      last: was.text,
      done: false,
    })
    // Back to what it said, before the browser has painted what it says now.
    node.data = was.text
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
      if (!job.node.isConnected || job.node.data !== job.last) {
        job.done = true
        continue
      }
      const t = (now - began - job.start) / job.length
      const moment = morphAt(job.plan, t, job)
      if (moment.text !== job.last) {
        job.node.data = moment.text
        job.last = moment.text
      }
      if (t >= 1) {
        job.done = true
        continue
      }
      live++
      if (!lit) continue
      for (const [from, to] of moment.hot) {
        if (ranges.length >= MOST.ranges) break
        const range = document.createRange()
        range.setStart(job.node, from)
        range.setEnd(job.node, to)
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
      if (job.node.isConnected && job.node.data === job.last) job.node.data = job.plan.to
    }
    finish()
  }
}
