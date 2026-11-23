import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { addWriter, rangesWithin, type Lay, type Writer } from './letterMorph'
import { beginsOnTheWay, wordsOf, wordsOnTheWay, type Mended, type MorphFrame, type Way } from './morph'

/** What a writer shows in place of what it was asked to: a step on the way there. */
interface Held {
  step: MorphFrame
  way: Way
  mended: Mended
}

/** Everything of a step that decides how it is drawn. */
const mark = (step: MorphFrame) => `${step.text}\n${step.words?.join('') ?? ''}`

/** One line of an element's words: the first and the last of them, how wide it is, and how wide each of them. */
interface Row {
  first: number
  last: number
  width: number
  each: number[]
}

/**
 * The lines an element's words are in. Every child that is not a line break is
 * a word, and one that is lower on the page than the one before it has begun a
 * line.
 */
function rowsOf(root: Element | null): Row[] {
  const rows: Row[] = []
  if (!root) return rows
  let above: number | null = null
  let left = 0
  let word = 0
  for (const child of root.children) {
    if (child.tagName === 'BR') continue
    const box = child as HTMLElement
    const row = rows[rows.length - 1]
    if (!row || (above !== null && box.offsetTop > above + 2)) {
      left = box.offsetLeft
      rows.push({ first: word, last: word, width: box.offsetWidth, each: [box.offsetWidth] })
    } else {
      row.last = word
      row.width = box.offsetLeft + box.offsetWidth - left
      row.each.push(box.offsetWidth)
    }
    above = box.offsetTop
    word++
  }
  return rows
}

const layOf = (rows: readonly Row[]): Lay => ({ lines: rows.slice(1).map((row) => row.first), widest: Math.max(0, ...rows.map((row) => row.width)) })

/**
 * The widest a line will be from here on, the front crossing it a word at a
 * time: each word as wide as it is now until its turn, the wider of that and
 * what it will be during it, and what it will be after.
 *
 * `after` is how wide each word of the line will be, or null for a word that
 * is only going: those go as the words before them grow, a letter for a
 * letter, and take up nothing that is not already taken up now. `until` is the
 * first word of the line that is going to drop off it, if one is: the front
 * gets no further along this line than that.
 */
function widestToCome(row: Row, after: readonly (number | null)[], until = row.each.length): number {
  const between = row.width - row.each.reduce((sum, width) => sum + width, 0)
  let widest = row.width
  for (let turn = 0; turn < until; turn++) {
    const width = row.each.reduce((sum, now, i) => {
      const will = after[i]
      return sum + (will == null ? 0 : i < turn ? will : i > turn ? now : Math.max(now, will))
    }, 0)
    widest = Math.max(widest, width + between)
  }
  return widest
}

/**
 * How far past its place a line may stand, in ems, before a word that is going
 * to drop off it anyway is hurried off — letters in the air alone can put it
 * that far — and how far it may be going to stand before a word that has come
 * up to it is sent back down: that moves everything below the text, twice, and
 * is not done for a letter's width.
 */
const SLACK = { hurry: 0.35, hold: 1 }

/**
 * For text that lays its own letters out — `SplitText`, a heading in masked
 * words — so that a change of language walks it to its translation letter by
 * letter like everything else on the page, instead of replacing it.
 *
 * Plain text is written into from outside (`letterMorph.ts`): React puts the
 * new string in a text node, and the old one is put back and walked there.
 * That cannot be done to a heading whose every word is an element of its own:
 * the old string and the new are different elements, and each step between
 * them a different number again. So this stands between what the heading is
 * asked to say and what it shows:
 *
 * - once React has written the new text, and before it is painted, it looks
 *   at how that lies and goes back to showing the old (`leave`);
 * - at each step of the change it is told what to say, and renders that, at
 *   once, so the lit letters can be found in what React has just written;
 * - and at the end it is showing what it was asked to, with nothing held.
 *
 * On the way, where its lines break is told too (`begins`: for each word,
 * whether it begins one — `beginsOnTheWay`). The lines the text had and the
 * lines it will have are both known — the second was on the page for a
 * moment, unpainted — so each break is moved once, as the front passes, and
 * the letters passing through, which are of every width, break nothing.
 *
 * Nothing breaks by itself then, so a line can outgrow its place: the words at
 * its head are already the longer ones they are turning into and the word
 * that will drop off its end has not been reached, or a word has come up to a
 * line whose others have yet to shrink. Each step is measured once it is on
 * the page, and a line found wider than the text has room for is mended there
 * and then (`Mended`).
 *
 * `rewritten` is true from the first time the text is anything but what it was
 * mounted with: what is made after that is replacing something a reader has
 * already seen, and should not make an entrance.
 */
export function useWriter(
  root: RefObject<HTMLElement | null>,
  text: string,
  shown: boolean,
): { text: string; begins: readonly boolean[] | null; rewritten: boolean } {
  const [asked, setAsked] = useState(text)
  const [held, setHeld] = useState<Held | null>(null)
  const [rewritten, setRewritten] = useState(false)
  /** What is on the page as of the last commit — or of the last thing said, if that is later. */
  const now = useRef({ said: text, asked: text, shown, held: false, mark: '' })
  /** The way it is on, for as long as it is: how the text will lie and how wide each word of it will be, how wide a line may be, and what has been mended so far. */
  const going = useRef<{ way: Way; will: Lay; widths: readonly number[]; room: number; mended: Mended } | null>(null)
  /** How it will lie once told to rest, for as long as the page has yet to catch up. */
  const settled = useRef<Lay | null>(null)

  const writer = useMemo<Writer>(() => {
    /** What a step, as it lies on the page, needs mending: a line that has outgrown its place, and the word to move off it. */
    const toMend = (step: MorphFrame): Mended | null => {
      const on = going.current
      const element = root.current
      if (!on || !element || !step.words) return null
      const { way, mended } = on
      const words = wordsOnTheWay(way, wordsOf(step.text).length)
      const em = parseFloat(getComputedStyle(element).fontSize) || 0
      for (const row of rowsOf(element)) {
        // Too long as it stands: a word that is going to begin a line anyway begins it now.
        if (row.width - on.room > SLACK.hurry * em) {
          for (let i = row.first + 1; i <= row.last; i++) {
            const word = words[i]!
            if (way.will.includes(word) && !way.was.includes(word) && !mended.hurried.includes(word)) return { ...mended, hurried: [...mended.hurried, word] }
          }
        }
        // Going to be much too long before it is over: the last word that came up to it goes back to the head of a line of its own.
        const here = row.each.map((_, i) => words[row.first + i]!)
        const after = here.map((word) => (word < way.to ? (on.widths[word] ?? 0) : null))
        const drops = here.findIndex((word, i) => i > 0 && way.will.includes(word) && !way.was.includes(word))
        if (widestToCome(row, after, drops < 0 ? undefined : drops) - on.room > SLACK.hold * em) {
          for (let i = row.last; i > row.first; i--) {
            const came = way.was.find((word) => word > words[i - 1]! && word <= words[i]! && !mended.held.includes(word))
            if (came !== undefined) return { ...mended, held: [...mended.held, came] }
          }
        }
      }
      return null
    }
    return {
      element: () => root.current,
      shown: () => now.current.shown,
      said: () => now.current.said,
      asked: () => now.current.asked,
      lay: () => settled.current ?? layOf(rowsOf(root.current)),
      leave(was, lay) {
        const rows = rowsOf(root.current)
        const will = layOf(rows)
        const way = { was: lay.lines, will: will.lines, from: wordsOf(was).length, to: wordsOf(now.current.asked).length }
        const mended: Mended = { hurried: [], held: [] }
        // A line may be as wide as the text is given room for, or as its widest line is, before or after.
        const room = Math.max(root.current?.parentElement?.clientWidth ?? 0, lay.widest, will.widest)
        going.current = { way, will, widths: rows.flatMap((row) => row.each), room, mended }
        const step: MorphFrame = { text: was, hot: [] }
        now.current = { ...now.current, said: was, held: true, mark: mark(step) }
        // Not flushed: this is inside React's commit, and what is set there is rendered before the paint.
        setHeld({ step, way, mended })
      },
      say(step, hot) {
        const element = root.current
        const last = now.current
        if (!element) return []
        if (last.held && last.mark !== mark(step)) {
          const over = step.text === last.asked
          now.current = { ...last, said: step.text, held: !over, mark: mark(step) }
          const on = over ? null : going.current
          if (!on) going.current = null
          // At once: the letters to light are looked for in the page straight after, and its lines measured.
          const show = () => flushSync(() => setHeld(on && { step, way: on.way, mended: on.mended }))
          show()
          for (let mended = toMend(step); on && mended; mended = toMend(step)) {
            on.mended = mended
            show()
          }
        }
        // Showing something else — it was given other text since it left — it has no letters of this step to point at.
        // Showing this, it has, held or not: the last letters to land are lit for a while after the text is all there.
        return now.current.said === step.text ? rangesWithin(element, step.text, hot) : []
      },
      rest() {
        now.current = { ...now.current, said: now.current.asked, held: false, mark: '' }
        settled.current = going.current?.will ?? null
        going.current = null
        setHeld(null)
      },
    }
  }, [root])

  if (asked !== text) {
    setAsked(text)
    setRewritten(true)
    // Whatever was held was on its way to the old text. The change of language says what happens next.
    setHeld(null)
  }
  const written = held?.step.text ?? text
  const begins = useMemo(() => held && beginsOnTheWay(held.way, held.step, held.mended), [held])

  useLayoutEffect(() => {
    now.current = { ...now.current, said: written, asked: text, shown, held: held !== null }
    settled.current = null
  })
  useLayoutEffect(() => addWriter(writer), [writer])

  return { text: written, begins, rewritten }
}
