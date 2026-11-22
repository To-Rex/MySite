import { describe, expect, it } from 'vitest'
import { morphAt, morphText, planMorph } from '@/i18n/morph'
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
    for (const [path, old] of differing) {
      const neu = oz.get(path)!
      for (const [from, to] of [
        [old, neu],
        [neu, old],
      ] as const) {
        const plan = planMorph(from, to)
        const kept = plan.slots.filter((slot) => slot.old === slot.neu).map((slot) => slot.old)
        // Nearly all of a sentence is kept. (A single word can be mostly digraphs: “Ochish”.)
        if (count(from) >= 24) expect(kept.length, path).toBeGreaterThan(count(from) * 0.6)
        // …and every letter that changes is one of the four spellings: o‘ g‘ sh ch against ö ğ ş ç.
        const changed = plan.slots.filter((slot) => slot.old !== slot.neu).flatMap((slot) => [slot.old, slot.neu])
        for (const char of changed) expect('oOgGsScChHʻʼ‘’\'`öÖğĞşŞçÇ', `${path}: “${char}” in “${from}”`).toContain(char)
        let last = count(from)
        for (const t of steps(60)) {
          // With no time in the air, every moment is made of nothing but old spellings and new ones.
          const text = morphAt(plan, t, { window: 0 }).text
          const now = Array.from(text)
          expect(isSubsequence(kept, now), `${path} at ${t}: “${text}”`).toBe(true)
          for (const char of now) expect(from + to, `${path} at ${t}: “${char}”`).toContain(char)
          expect(count(to) >= count(from) ? now.length >= last : now.length <= last, `${path} at ${t}`).toBe(true)
          last = now.length
        }
      }
    }
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
    for (const from of LANGUAGES) {
      for (const to of LANGUAGES) {
        if (from === to) continue
        for (const [path, old] of all[from]!) {
          const neu = all[to]!.get(path)
          if (neu === undefined) continue
          const plan = planMorph(old, neu)
          expect(morphAt(plan, 0).text).toBe(old)
          expect(morphAt(plan, 1).text).toBe(neu)
          // Read off its plan, the old string and the new one are both there, whole.
          expect(plan.slots.map((slot) => slot.old).join('')).toBe(old)
          expect(plan.slots.map((slot) => slot.neu).join('')).toBe(neu)
          const growing = count(neu) >= count(old)
          let last = count(old)
          for (const t of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.99]) {
            const length = count(morphAt(plan, t).text)
            expect(growing ? length >= last : length <= last, `${from}→${to} ${path} at ${t}`).toBe(true)
            last = length
          }
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(2000)
  })
})
