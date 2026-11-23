import { describe, expect, it } from 'vitest'
import { beginsOnTheWay, linesOnTheWay, morphAt, morphText, planMorph, planMorphByWord, wordsOf, wordsOnTheWay, type WordPhase } from '@/i18n/morph'
import { dictionaries } from '@/i18n/context'
import { LANGUAGES, type Dictionary } from '@/i18n/types'

/**
 * A change of language is shown as each visible string turning into its
 * translation letter by letter. The page's real text is put back at the end,
 * so what has to hold of the way there: it starts as the old string and ends
 * as the new one, exactly; what the two share does not flicker; the string
 * never grows and then shrinks; and it is the same every time.
 */

const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n)
const count = (text: string) => Array.from(text).length

/** Every string in a dictionary, by path, so the same line can be found in another language. */
function lines(dictionary: Dictionary): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') out.set(path, value)
    else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}.${i}`))
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`)
  }
  walk(dictionary, '')
  return out
}

/** Whether `inner` can be read off `outer` in order, skipping letters. */
function isSubsequence(inner: string[], outer: string[]): boolean {
  let i = 0
  for (const char of outer) if (i < inner.length && char === inner[i]) i++
  return i === inner.length
}

const PAIRS: [string, string][] = [
  ['Projects', 'Projekte'],
  ['Human first. Developer second.', 'Сначала человек. Потом разработчик.'],
  ['Things I have created', 'Was ich gebaut habe'],
  ['Contact', 'Kontakt'],
  ['365 in the last 12 months', '365 in den letzten 12 Monaten'],
  ['a', 'a long way from a'],
  ['', 'out of nothing'],
  ['into nothing', ''],
  ['Straße', 'STRASSE'],
  ['same', 'same'],
]

describe('one string turning into another', () => {
  it('is the old string before anything has moved and the new one when it is over, exactly', () => {
    for (const [from, to] of PAIRS) {
      expect(morphText(from, to, 0)).toBe(from)
      expect(morphText(from, to, -3)).toBe(from)
      expect(morphText(from, to, 1)).toBe(to)
      expect(morphText(from, to, 2)).toBe(to)
      // Not a moment at all: the end, never something half way.
      expect(morphText(from, to, Number.NaN)).toBe(to)
    }
  })

  it('is the same every time it is asked', () => {
    for (const [from, to] of PAIRS) {
      const plan = planMorph(from, to)
      for (const t of steps(40)) {
        expect(morphAt(plan, t)).toEqual(morphAt(plan, t))
        expect(morphAt(planMorph(from, to), t).text).toBe(morphAt(plan, t).text)
      }
    }
  })

  it('never grows and then shrinks, nor the other way round', () => {
    for (const [from, to] of PAIRS) {
      for (const window of [0, 0.15, 0.4]) {
        const plan = planMorph(from, to)
        const growing = count(to) >= count(from)
        let last = count(from)
        for (const t of steps(400)) {
          const length = count(morphAt(plan, t, { window }).text)
          expect(growing ? length >= last : length <= last, `"${from}" → "${to}" at ${t}: ${last} then ${length}`).toBe(true)
          last = length
        }
        expect(last).toBe(count(to))
      }
    }
  })

  it('holds still what the two strings share at either end', () => {
    for (const [from, to, head, tail] of [
      ['Open GitHub profile', 'Open GitHub profiles', 'Open GitHub profile', ''],
      ['My projects.', 'My products.', 'My pro', 'ts.'],
      ['On GitHub since 2021', 'Auf GitHub seit 2021', '', ' 2021'],
    ] as const) {
      const plan = planMorph(from, to)
      for (const t of steps(120)) {
        const { text } = morphAt(plan, t)
        expect(text.startsWith(head), `"${text}" at ${t}`).toBe(true)
        expect(text.endsWith(tail), `"${text}" at ${t}`).toBe(true)
      }
    }
  })

  it('holds a letter that is the same in the same place, and puts letters of the new language in the air', () => {
    const plan = planMorph('Contact', 'Kontakt')
    const seen = new Set<string>()
    for (const t of steps(200)) {
      const letters = Array.from(morphAt(plan, t).text)
      expect(letters).toHaveLength(7)
      // o, n, t, a and the last t are where they were.
      expect([letters[1], letters[2], letters[3], letters[4], letters[6]].join('')).toBe('ontat')
      seen.add(letters[0]!)
      seen.add(letters[5]!)
    }
    // The two that change show something on the way, and only ever letters of the word they are landing in.
    expect(seen.size).toBeGreaterThan(4)
    for (const letter of seen) expect('ContactKontakt'.toLowerCase()).toContain(letter.toLowerCase())
  })

  it('keeps the case and the kind of what is landing: capitals for capitals, digits for digits', () => {
    const plan = planMorph('abcdefgh 1234', 'QRSTUVWX 5678')
    for (const t of steps(200)) {
      const { text } = morphAt(plan, t)
      expect(text).toHaveLength(13)
      expect(text[8]).toBe(' ')
      // Whatever is no longer the old letter is a capital, or a digit, like the one it is becoming.
      for (const [i, char] of Array.from(text).entries()) {
        if (i === 8 || char === plan.from[i]) continue
        expect(char, `"${text}" at ${t}`).toMatch(i < 8 ? /^\p{Lu}$/u : /^\d$/)
      }
    }
  })

  it('says which letters are changing, as ranges of the string it wrote', () => {
    for (const [from, to] of PAIRS) {
      const plan = planMorph(from, to)
      let ever = 0
      for (const t of steps(200)) {
        const { text, hot } = morphAt(plan, t, { window: 0.3, glow: 0.4 })
        let end = 0
        for (const [start, stop] of hot) {
          expect(start).toBeGreaterThanOrEqual(end)
          expect(stop).toBeGreaterThan(start)
          expect(stop).toBeLessThanOrEqual(text.length)
          expect(text.slice(start, stop)).not.toMatch(/^\s+$/)
          end = stop
          ever++
        }
      }
      // A string that only loses letters has none arriving to point at.
      if (to && from !== to) expect(ever, `"${from}" → "${to}"`).toBeGreaterThan(0)
      else expect(ever).toBe(0)
    }
    expect(morphAt(planMorph('Contact', 'Kontakt'), 0).hot).toEqual([])
    expect(morphAt(planMorph('Contact', 'Kontakt'), 1).hot).toEqual([])
  })

  it('counts what changes, so a caller can give a long change longer', () => {
    expect(planMorph('same', 'same').changes).toBe(0)
    expect(planMorph('Contact', 'Kontakt').changes).toBe(2)
    expect(planMorph('', 'four').changes).toBe(4)
    expect(planMorph('Shahar', 'Şahar').changes).toBe(2)
  })
})

describe('between the two Uzbek alphabets', () => {
  const uz = lines(dictionaries.uz)
  const oz = lines(dictionaries.oz)
  const differing = [...uz].filter(([path, text]) => oz.get(path) !== undefined && oz.get(path) !== text)

  it('has real text to work on', () => {
    expect(differing.length).toBeGreaterThan(50)
  })

  it('only the spellings that differ ever change, and each at once', () => {
    // Every line of the site that is spelt differently, both ways. Whatever goes wrong is
    // collected and shown once: a check per letter per moment would be a million of them.
    const FOUR = new Set('oOgGsScChHʻʼ‘’\'`öÖğĞşŞçÇ')
    const wrong: string[] = []
    for (const [path, old] of differing) {
      const neu = oz.get(path)!
      for (const [from, to] of [
        [old, neu],
        [neu, old],
      ] as const) {
        const plan = planMorph(from, to)
        const kept = plan.slots.filter((slot) => slot.old === slot.neu).map((slot) => slot.old)
        // Nearly all of a sentence is kept. (A single word can be mostly digraphs: “Ochish”.)
        if (count(from) >= 24 && kept.length <= count(from) * 0.6) wrong.push(`${path}: only ${kept.length} of ${count(from)} letters kept`)
        // Every letter that changes is one of the four spellings: o‘ g‘ sh ch against ö ğ ş ç.
        for (const slot of plan.slots) {
          if (slot.old !== slot.neu && ![...slot.old, ...slot.neu].every((char) => FOUR.has(char))) wrong.push(`${path}: “${slot.old}” → “${slot.neu}” in “${from}”`)
        }
        const either = new Set(from + to)
        let last = count(from)
        for (const t of steps(24)) {
          // With no time in the air, every moment is made of nothing but old spellings and new ones.
          const now = Array.from(morphAt(plan, t, { window: 0 }).text)
          if (!isSubsequence(kept, now)) wrong.push(`${path} at ${t}: lost a letter it shares — “${now.join('')}”`)
          if (!now.every((char) => either.has(char))) wrong.push(`${path} at ${t}: a letter of neither — “${now.join('')}”`)
          if (count(to) >= count(from) ? now.length < last : now.length > last) wrong.push(`${path} at ${t}: ${last} letters, then ${now.length}`)
          last = now.length
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('turns a digraph into its letter in one go, never leaving half of it behind', () => {
    const plan = planMorph('Shahar choʻqqisi', 'Şahar çöqqisi')
    const seen = new Set<string>()
    for (const t of steps(300)) seen.add(morphAt(plan, t, { window: 0 }).text)
    expect([...seen]).toEqual(['Shahar choʻqqisi', 'Şahar choʻqqisi', 'Şahar çoʻqqisi', 'Şahar çöqqisi'])
  })

  it('aligns them however many spellings differ, where a sentence and its translation are not', () => {
    // Nearly every letter here is part of a digraph, and every one is still paired with its own.
    const dense = planMorph('choʻchqa shoʻr', 'çöçqa şör')
    expect(dense.slots.filter((slot) => slot.old === slot.neu).map((slot) => slot.old).join('')).toBe('qa r')
    expect(dense.slots.filter((slot) => slot.old && slot.neu && slot.old !== slot.neu).map((slot) => slot.old + slot.neu)).toEqual(['cç', 'oö', 'cç', 'sş', 'oö'])
    for (const word of ['ch', 'sh', 'oʻ', 'gʻ', 'Oʻsh', 'gʻoʻsh', 'shch']) {
      const respelt = word.replace(/sh/g, 'ş').replace(/ch/g, 'ç').replace(/oʻ/g, 'ö').replace(/Oʻ/g, 'Ö').replace(/gʻ/g, 'ğ')
      expect(planMorph(word, respelt).slots.every((slot) => slot.old !== '' || slot.neu === ''), word).toBe(true)
      expect(count(planMorph(word, respelt).slots.map((slot) => slot.neu).join('')), word).toBe(count(respelt))
    }
    // Two sentences that merely share letters are not threaded through each other: they have a dozen
    // letters in common, in order, and next to nothing is kept — only what is in the same place.
    const loose = planMorph('Human first. Developer second.', 'Zuerst Mensch. Dann Entwickler.')
    expect(loose.slots.filter((slot) => slot.old === slot.neu).length).toBeLessThan(6)
    expect(loose.changes).toBeGreaterThan(25)
  })
})

describe('across every pair of languages the site has', () => {
  const all = Object.fromEntries(LANGUAGES.map((language) => [language, lines(dictionaries[language])]))

  it('gets every line of the site from each language to each other, and back to exactly itself', () => {
    let checked = 0
    const wrong: string[] = []
    for (const from of LANGUAGES) {
      for (const to of LANGUAGES) {
        if (from === to) continue
        for (const [path, old] of all[from]!) {
          const neu = all[to]!.get(path)
          if (neu === undefined) continue
          const plan = planMorph(old, neu)
          const where = `${from}→${to} ${path}`
          if (morphAt(plan, 0).text !== old) wrong.push(`${where}: does not start as itself`)
          if (morphAt(plan, 1).text !== neu) wrong.push(`${where}: does not end as its translation`)
          // Read off its plan, the old string and the new one are both there, whole.
          if (plan.slots.map((slot) => slot.old).join('') !== old || plan.slots.map((slot) => slot.neu).join('') !== neu) wrong.push(`${where}: the plan is not of these two strings`)
          const growing = count(neu) >= count(old)
          let last = count(old)
          for (const t of [0.15, 0.4, 0.65, 0.9]) {
            const length = count(morphAt(plan, t).text)
            if (growing ? length < last : length > last) wrong.push(`${where} at ${t}: ${last} letters, then ${length}`)
            last = length
          }
          checked++
        }
      }
    }
    expect(wrong).toEqual([])
    expect(checked).toBeGreaterThan(2000)
  })
})

/**
 * A heading is set word by word, each in a box of its own, so it is walked to
 * its translation word against word: nothing reaches across a space, the words
 * one text has more of come or go at its end, and the plan says how far along
 * each word is — which is what its lines are moved by.
 */
describe('a heading, word against word', () => {
  const all = Object.fromEntries(LANGUAGES.map((language) => [language, lines(dictionaries[language])]))
  /** Every line of the site in every pair of languages: a heading is any of them. */
  function everyPair(check: (old: string, neu: string, where: string) => void): number {
    let checked = 0
    for (const from of LANGUAGES) {
      for (const to of LANGUAGES) {
        if (from === to) continue
        for (const [path, old] of all[from]!) {
          const neu = all[to]!.get(path)
          if (neu === undefined || neu === old) continue
          check(old, neu, `${from}→${to} ${path}`)
          checked++
        }
      }
    }
    return checked
  }

  it('gets every line of the site from each language to each other, exactly', () => {
    const wrong: string[] = []
    const checked = everyPair((old, neu, where) => {
      const plan = planMorphByWord(old, neu)
      if (morphAt(plan, 0).text !== old) wrong.push(`${where}: does not start as itself`)
      if (morphAt(plan, 1).text !== neu) wrong.push(`${where}: does not end as its translation`)
      if (plan.slots.map((slot) => slot.old).join('') !== old || plan.slots.map((slot) => slot.neu).join('') !== neu) wrong.push(`${where}: the plan is not of these two strings`)
      if (plan.slots.some((slot) => !(slot.at >= 0 && slot.at <= 1))) wrong.push(`${where}: a letter with no moment of its own`)
    })
    expect(wrong).toEqual([])
    expect(checked).toBeGreaterThan(2000)
  }, 30_000)

  it('keeps every word a word: none fuses with the next, and the number of them moves one way only', () => {
    const wrong: string[] = []
    everyPair((old, neu, where) => {
      const plan = planMorphByWord(old, neu)
      if (!plan.words) return
      const [from, to] = [wordsOf(old).length, wordsOf(neu).length]
      let last = from
      for (const t of steps(12)) {
        const now = wordsOf(morphAt(plan, t, { window: 0.2 }).text).length
        if (to >= from ? now < last || now > to : now > last || now < to) wrong.push(`${where} at ${t}: ${last} words, then ${now}`)
        last = now
      }
    })
    expect(wrong).toEqual([])
  }, 30_000)

  it('says how far along each word is: what it was until the front is there, what it will be once it has landed', () => {
    const wrong: string[] = []
    everyPair((old, neu, where) => {
      const plan = planMorphByWord(old, neu)
      if (!plan.words) return
      const [was, will] = [wordsOf(old), wordsOf(neu)]
      expect(morphAt(plan, 0).words).toEqual(plan.words.map(() => 0))
      expect(morphAt(plan, 1).words).toEqual(plan.words.map(() => 2))
      let last: readonly WordPhase[] = plan.words.map(() => 0)
      for (const t of steps(12)) {
        const { text, words } = morphAt(plan, t, { window: 0.2 })
        if (!words || words.length !== Math.max(was.length, will.length)) return void wrong.push(`${where} at ${t}: no word for each word`)
        if (words.some((phase, i) => phase < last[i]!)) wrong.push(`${where} at ${t}: a word went backwards`)
        last = words
        // The words the two texts share are in their places all the way, so each can be asked about.
        const now = wordsOf(text)
        for (let i = 0; i < Math.min(was.length, will.length); i++) {
          if (words[i] === 0 && now[i] !== was[i]) wrong.push(`${where} at ${t}: “${now[i]}” is not yet reached and is not “${was[i]}”`)
          if (words[i] === 2 && now[i] !== will[i]) wrong.push(`${where} at ${t}: “${now[i]}” has landed and is not “${will[i]}”`)
        }
      }
    })
    expect(wrong).toEqual([])
  }, 30_000)

  it('lets the words that go leave as the words before them grow, so the text is never longer than it was', () => {
    const plan = planMorphByWord('Avvalo — inson. Keyin — dasturchi.', 'Human first. Developer second.')
    for (const window of [0, 0.2, 0.4]) {
      for (const t of steps(200)) {
        const { text, words } = morphAt(plan, t, { window })
        expect(count(text), `“${text}” at ${t}`).toBeLessThanOrEqual(34)
        expect(count(text)).toBeGreaterThanOrEqual(30)
        // They are gone by the time the last word the two share is what it will be: nothing is left for the front to come back for.
        if (words![3] === 2) expect(wordsOf(text), `“${text}” at ${t}`).toHaveLength(4)
      }
    }
    // Where the words before them do not grow there is room, and they wait for the front.
    const waiting = planMorphByWord('one two three four five', 'a b c')
    const half = morphAt(waiting, 0.3, { window: 0 })
    expect(wordsOf(half.text).slice(-2)).toEqual(['four', 'five'])
  })

  it('brings the words that come when the front gets there, each with its space', () => {
    const plan = planMorphByWord('Human first. Developer second.', 'Avvalo — inson. Keyin — dasturchi.')
    for (const t of steps(200)) {
      const { text, words } = morphAt(plan, t, { window: 0.2 })
      expect(text).not.toMatch(/\s$|\s\s/)
      // Nothing of them before the front has reached the last word they follow.
      if (words![3] === 0) expect(wordsOf(text), `“${text}” at ${t}`).toHaveLength(4)
      if (words![4]! > 0) expect(wordsOf(text).length).toBeGreaterThan(4)
    }
  })

  it('does not set word against word two texts that share fewer than two', () => {
    for (const [from, to] of [
      ['Technology universe', 'Technologie-Universum'],
      ['Technologie-Universum', 'Вселенная технологий'],
      ['', 'out of nothing'],
      ['into nothing', ''],
    ] as const) {
      const plan = planMorphByWord(from, to)
      expect(plan.words).toBeUndefined()
      for (const t of steps(20)) expect(morphAt(plan, t)).toEqual(morphAt(planMorph(from, to), t))
    }
    // One word turning into one word is word against word, and nothing else.
    expect(planMorphByWord('Dilshodjon', 'Dilşodjon').words).toHaveLength(1)
  })

  it('is the same change as ever between the two alphabets: only the spellings that differ, each at once', () => {
    for (const path of ['.building.title', '.presence.title', '.notFound.title', '.about.title', '.hero.firstName']) {
      const [from, to] = [all.uz!.get(path)!, all.oz!.get(path)!]
      expect(from).not.toBe(to)
      const seen = (plan: ReturnType<typeof planMorph>) => [...new Set(steps(300).map((t) => morphAt(plan, t, { window: 0 }).text))]
      expect(seen(planMorphByWord(from, to)), path).toEqual(seen(planMorph(from, to)))
      expect(seen(planMorphByWord(to, from)), path).toEqual(seen(planMorph(to, from)))
    }
  })

  it('puts in the air letters about as wide as the ones landing, where the text has any', () => {
    // f, i and l take little room and m takes a lot: “film” and “mill” have both kinds to choose from.
    const narrow = new Set('fil')
    const plan = planMorphByWord('aaaa bbbb', 'film mill')
    let passing = 0
    for (const t of steps(400)) {
      const { text } = morphAt(plan, t, { window: 0.4 })
      for (const [i, char] of Array.from(text).entries()) {
        const [old, neu] = [plan.from[i]!, plan.to[i]!]
        if (char === old || char === neu) continue
        passing++
        expect(narrow.has(char), `“${char}” on its way to “${neu}” in “${text}”`).toBe(narrow.has(neu))
      }
    }
    expect(passing).toBeGreaterThan(50)
    // Text that is broken afresh as it changes is not held to that.
    const loose = planMorph('aaaa bbbb', 'film mill')
    expect(steps(400).some((t) => Array.from(morphAt(loose, t, { window: 0.4 }).text).some((char, i) => char !== loose.from[i] && char !== loose.to[i] && narrow.has(char) !== narrow.has(loose.to[i]!)))).toBe(true)
  })
})

/**
 * Where the lines of such a heading break while it is on its way. The text is
 * not left to break itself: the widths of the letters passing through would
 * break and mend a line from one step to the next. Each break is moved once.
 */
describe('the lines of a heading on its way', () => {
  /** How far along each of `n` words is, step by step, as a front crosses them with `lag` words still changing behind it. */
  const sweep = (n: number, lag: number): WordPhase[][] =>
    Array.from({ length: n + lag + 1 }, (_, front) => Array.from({ length: n }, (_, word): WordPhase => (word < front - lag ? 2 : word < front ? 1 : 0)))
  /** Every way of breaking `n` words into lines: the words, after the first, that begin one. */
  const layouts = (n: number): number[][] =>
    Array.from({ length: 2 ** (n - 1) }, (_, bits) => Array.from({ length: n - 1 }, (_, i) => i + 1).filter((word) => bits & (1 << (word - 1))))

  it('are the ones it had before anything has moved, and the ones it will have when it is over', () => {
    for (const was of layouts(5)) {
      for (const will of layouts(5)) {
        expect(linesOnTheWay(was, will, [0, 0, 0, 0, 0])).toEqual(was)
        expect(linesOnTheWay(was, will, [2, 2, 2, 2, 2])).toEqual(will)
        expect(linesOnTheWay(was, will, [])).toEqual(was)
      }
    }
  })

  it('move each break once, and the number of lines only ever towards what it will be', () => {
    for (const was of layouts(5)) {
      for (const will of layouts(5)) {
        for (const lag of [0, 1, 2]) {
          const path = sweep(5, lag).map((words) => linesOnTheWay(was, will, words))
          const where = `[${was}] → [${will}], ${lag} behind: ${path.map((lines) => `[${lines}]`).join(' ')}`
          for (let i = 1; i < path.length; i++) {
            expect(will.length >= was.length ? path[i]!.length >= path[i - 1]!.length : path[i]!.length <= path[i - 1]!.length, where).toBe(true)
          }
          for (const word of [1, 2, 3, 4]) {
            const there = path.map((lines) => lines.includes(word))
            expect(there.filter((now, i) => i > 0 && now !== there[i - 1]).length, where).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('drop a word to a line of its own as the front reaches it, and bring one up when it has landed', () => {
    // “A B C” becoming “A / B / C”, and back.
    expect(linesOnTheWay([], [1, 2], [1, 0, 0])).toEqual([])
    expect(linesOnTheWay([], [1, 2], [2, 1, 0])).toEqual([1])
    expect(linesOnTheWay([], [1, 2], [2, 2, 1])).toEqual([1, 2])
    expect(linesOnTheWay([1, 2], [], [2, 1, 0])).toEqual([1, 2])
    expect(linesOnTheWay([1, 2], [], [2, 2, 1])).toEqual([2])
    expect(linesOnTheWay([1, 2], [], [2, 2, 2])).toEqual([])
  })

  it('pair a break that goes with the nearest that comes: “A B / C / D” is “A / B C / D” in one move', () => {
    const [was, will] = [[2, 3], [1, 3]]
    expect(linesOnTheWay(was, will, [1, 0, 0, 0])).toEqual([2, 3])
    // B reached: it drops, and C comes up to it in the same instant though the front is nowhere near C.
    expect(linesOnTheWay(was, will, [2, 1, 0, 0])).toEqual([1, 3])
    // The other way round, C landing is the moment: B comes up and D… stays, there being three lines either way.
    expect(linesOnTheWay(will, was, [2, 1, 0, 0])).toEqual([1, 3])
    expect(linesOnTheWay(will, was, [2, 2, 1, 0])).toEqual([2, 3])
  })

  it('keep a line of words that only go until the last of them has gone', () => {
    // Six words in three lines becoming four in three: the fourth is to drop to the line the fifth and sixth are leaving.
    const [was, will] = [[2, 4], [2, 3]]
    // The fifth is gone, the sixth is not, and the front has not reached the fourth: nothing moves.
    expect(linesOnTheWay(was, will, [2, 2, 1, 0, 2, 1], 4)).toEqual([2, 4])
    // Both gone: their line is over, and the fourth has it.
    expect(linesOnTheWay(was, will, [2, 2, 1, 0, 2, 2], 4)).toEqual([2, 3])
    // Or the front reaches the fourth first: it drops, to the line the sixth is still on.
    expect(linesOnTheWay(was, will, [2, 2, 2, 1, 2, 1], 4)).toEqual([2, 3])
    // A word that goes from the middle of a text that keeps its words is only a word that has landed.
    expect(linesOnTheWay(was, will, [2, 2, 1, 0, 2, 1])).toEqual([2, 3])
  })

  it('can be told to hurry a word that was going to drop, and nothing else', () => {
    expect(linesOnTheWay([], [2], [1, 0, 0])).toEqual([])
    expect(linesOnTheWay([], [2], [1, 0, 0], Infinity, { hurried: [2], held: [] })).toEqual([2])
    // Its pair goes with it.
    expect(linesOnTheWay([3], [2], [1, 0, 0, 0], Infinity, { hurried: [2], held: [] })).toEqual([2])
    // A word that was never going to begin a line does not begin one for being hurried.
    expect(linesOnTheWay([], [2], [1, 0, 0], Infinity, { hurried: [1], held: [] })).toEqual([])
    expect(linesOnTheWay([1], [], [0, 0, 0], Infinity, { hurried: [1, 2], held: [] })).toEqual([1])
  })

  it('can be told to hold a word that came up too soon, until the two lines it stands between have landed', () => {
    // “A B / C” becoming “A / B C”: with C held, B still drops when it is reached, and there are three lines for a while.
    const [was, will] = [[2], [1]]
    const held = { hurried: [], held: [2] }
    expect(linesOnTheWay(was, will, [2, 1, 0])).toEqual([1])
    expect(linesOnTheWay(was, will, [2, 1, 0], Infinity, held)).toEqual([1, 2])
    expect(linesOnTheWay(was, will, [2, 2, 1], Infinity, held)).toEqual([1, 2])
    expect(linesOnTheWay(was, will, [2, 2, 2], Infinity, held)).toEqual([1])
    // Only B and C have to have landed: they are the two lines. A is on a line of its own by then.
    expect(linesOnTheWay([2], [1], [1, 2, 2], Infinity, held)).toEqual([1])
    // A word that did not begin a line is not made to by being held.
    expect(linesOnTheWay([], [1], [0, 0, 0], Infinity, { hurried: [], held: [2] })).toEqual([])
  })

  it('are told word by word, a line that began with a word since gone beginning with the next still there', () => {
    const way = { was: [2, 4], will: [2, 3], from: 6, to: 4 }
    expect(wordsOnTheWay(way, 6)).toEqual([0, 1, 2, 3, 4, 5])
    expect(wordsOnTheWay(way, 5)).toEqual([0, 1, 2, 3, 5])
    expect(wordsOnTheWay(way, 4)).toEqual([0, 1, 2, 3])
    expect(wordsOnTheWay({ ...way, from: 4, to: 6 }, 5)).toEqual([0, 1, 2, 3, 4])
    const step = (text: string, words: WordPhase[]) => ({ text, hot: [], words })
    expect(beginsOnTheWay(way, step('a b c d e f', [0, 0, 0, 0, 0, 0]))).toEqual([false, false, true, false, true, false])
    // The fifth word has gone: the sixth is the fifth now, and begins the line the fifth began.
    expect(beginsOnTheWay(way, step('A B c d f', [2, 2, 1, 0, 2, 1]))).toEqual([false, false, true, false, true])
    expect(beginsOnTheWay(way, step('A B C D', [2, 2, 2, 2, 2, 2]))).toEqual([false, false, true, true])
  })

  it('are all that is known of a text that is not set word against word: how it lay while it has the words it had, and how it will', () => {
    const way = { was: [1], will: [], from: 2, to: 1 }
    expect(beginsOnTheWay(way, { text: 'Вселенная технологий', hot: [] })).toEqual([false, true])
    expect(beginsOnTheWay(way, { text: 'Technologie-Universum', hot: [] })).toEqual([false])
    expect(beginsOnTheWay({ was: [], will: [1, 2], from: 1, to: 3 }, { text: 'half way', hot: [] })).toBeNull()
  })
})
