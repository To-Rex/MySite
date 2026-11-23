// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SplitText } from '@/components/ui/SplitText'
import { I18nProvider } from '@/i18n/I18nProvider'
import { dictionaries, useI18n, type I18nContextValue } from '@/i18n/context'
import { MORPHING, addWriter, canMorph, captureText, playMorph, rangesWithin, type Lay, type Writer } from '@/i18n/letterMorph'
import type { MorphFrame } from '@/i18n/morph'

/**
 * The change of language as it happens on a page: the old text put back into
 * the nodes React has just rewritten, walked to the new text, and left as
 * exactly what React wrote. jsdom lays nothing out, so every element is given
 * a place on screen by hand; time is driven by hand too.
 */

const ON_SCREEN = { top: 100, left: 40 }
const everywhere = () => ON_SCREEN

/** Lets a millisecond count of animation frames go by. */
const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

function stubBrowser({ reducedMotion = false } = {}) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reducedMotion && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }))
  // Everything is on screen: a box with a size, inside the window.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 100, left: 40, bottom: 120, right: 240, width: 200, height: 20, x: 40, y: 100, toJSON: () => ({}) })
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute(MORPHING)
  document.body.removeAttribute('aria-busy')
})

describe('what is captured', () => {
  it('is the text a reader can see, and nothing that is read aloud, typed into or covered', () => {
    document.body.innerHTML = `
      <p id="plain">Seen</p>
      <p aria-hidden="true">Decoration is seen too</p>
      <p class="sr-only">For a screen reader only</p>
      <p aria-live="polite">Read aloud as it changes</p>
      <p role="status">So is this</p>
      <div inert><p>Under an open dialog</p></div>
      <div data-no-morph><p>Asked to be left out</p></div>
      <textarea>Typed</textarea>
      <svg><text>Drawn</text></svg>
      <script>var not = "text"</script>
      <p>   </p>
    `
    const captured = captureText(document.body, everywhere)
    expect([...captured.values()].map((entry) => entry.text)).toEqual(['Seen', 'Decoration is seen too'])
    expect([...captured.values()][0]).toEqual({ text: 'Seen', ...ON_SCREEN })
  })

  it('is only what is on screen', () => {
    document.body.innerHTML = '<p data-seen>Here</p><p>Far below the fold</p>'
    const captured = captureText(document.body, (element) => (element.hasAttribute('data-seen') ? ON_SCREEN : null))
    expect([...captured.values()].map((entry) => entry.text)).toEqual(['Here'])
  })

  it('is never more than a page of it', () => {
    document.body.innerHTML = Array.from({ length: 600 }, (_, i) => `<p>Line ${i}</p>`).join('')
    expect(captureText(document.body, everywhere).size).toBe(220)
    document.body.innerHTML = Array.from({ length: 50 }, () => `<p>${'word '.repeat(200)}</p>`).join('')
    expect(captureText(document.body, everywhere).size).toBeLessThan(15)
  })

  it('asks where an element is once, however many pieces of text it holds', () => {
    document.body.innerHTML = '<p>one <b>two</b> three</p>'
    const place = vi.fn(everywhere)
    expect(captureText(document.body, place).size).toBe(3)
    expect(place).toHaveBeenCalledTimes(2)
  })
})

describe('the change, played', () => {
  /** A paragraph React might have just rewritten: captured as `from`, now saying `to`. */
  function rewritten(from: string, to: string) {
    document.body.innerHTML = `<p>${from}</p>`
    const node = document.body.querySelector('p')!.firstChild as Text
    const captured = captureText(document.body, everywhere)
    node.data = to
    return { node, captured }
  }

  /** Everything a node says from now until the change is over. */
  function watch(node: Text, ms = 2000): string[] {
    const seen = [node.data]
    for (let elapsed = 0; elapsed < ms; elapsed += 16) {
      vi.advanceTimersByTime(16)
      if (seen[seen.length - 1] !== node.data) seen.push(node.data)
    }
    return seen
  }

  it('puts the old text back at once, walks it to the new, and leaves exactly the new', () => {
    const { node, captured } = rewritten('Human first. Developer second.', 'Zuerst Mensch. Dann Entwickler.')
    playMorph(captured)
    expect(node.data).toBe('Human first. Developer second.')
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(true)
    expect(document.body.getAttribute('aria-busy')).toBe('true')

    const seen = watch(node)
    expect(seen[0]).toBe('Human first. Developer second.')
    expect(seen[seen.length - 1]).toBe('Zuerst Mensch. Dann Entwickler.')
    // It was on its way for a while: a good many things that are neither.
    expect(seen.length).toBeGreaterThan(10)
    // And it only ever got longer: the new sentence is the longer one.
    for (let i = 1; i < seen.length; i++) expect(Array.from(seen[i]!).length).toBeGreaterThanOrEqual(Array.from(seen[i - 1]!).length)

    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    expect(document.body.hasAttribute('aria-busy')).toBe(false)
  })

  it('does not rewrite a node more than about thirty times a second', () => {
    const { node, captured } = rewritten('Human first. Developer second.', 'Zuerst Mensch. Dann Entwickler.')
    playMorph(captured)
    const writes = vi.fn()
    const observer = new MutationObserver((records) => records.forEach(writes))
    observer.observe(node, { characterData: true })
    vi.advanceTimersByTime(300)
    return Promise.resolve().then(() => {
      observer.disconnect()
      expect(writes.mock.calls.length).toBeGreaterThan(4)
      expect(writes.mock.calls.length).toBeLessThanOrEqual(11)
    })
  })

  it('between two spellings turns each letter over where it stands, showing nothing that is in neither', () => {
    const { node, captured } = rewritten('Shahar choʻqqisi', 'Şahar çöqqisi')
    playMorph(captured, { flip: true })
    expect(watch(node)).toEqual(['Shahar choʻqqisi', 'Şahar choʻqqisi', 'Şahar çoʻqqisi', 'Şahar çöqqisi'])
  })

  it('lets go of a node that someone else has written to since', () => {
    const { node, captured } = rewritten('Old text here', 'New text here now')
    const other = document.body.appendChild(document.createElement('p'))
    other.textContent = 'Untouched'
    playMorph(captured)
    vi.advanceTimersByTime(200)
    // React, with newer text.
    node.data = 'Newer than either'
    expect(watch(node)).toEqual(['Newer than either'])
    expect(other.textContent).toBe('Untouched')
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
  })

  it('lets go of a node that has left the page, and does not write to it again', () => {
    const { node, captured } = rewritten('Old text here', 'New text here now')
    playMorph(captured)
    vi.advanceTimersByTime(200)
    const midway = node.data
    node.parentElement!.remove()
    vi.advanceTimersByTime(2000)
    expect(node.data).toBe(midway)
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
  })

  it('can be ended at once, leaving what it still holds as the new text and nothing running', () => {
    const { node, captured } = rewritten('Old text here', 'New text here now')
    const settle = playMorph(captured)
    vi.advanceTimersByTime(150)
    expect(node.data).not.toBe('New text here now')
    settle()
    expect(node.data).toBe('New text here now')
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    expect(document.body.hasAttribute('aria-busy')).toBe(false)
    // Ending it twice, or after it is over, is nothing.
    settle()
    expect(watch(node)).toEqual(['New text here now'])
  })

  it('does not give back a node it let go of when it is ended', () => {
    const { node, captured } = rewritten('Old text here', 'New text here now')
    const settle = playMorph(captured)
    vi.advanceTimersByTime(150)
    node.data = 'Newer than either'
    settle()
    expect(node.data).toBe('Newer than either')
  })

  it('is nothing at all when nothing has changed', () => {
    document.body.innerHTML = '<p>Same</p>'
    const captured = captureText(document.body, everywhere)
    playMorph(captured)
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    expect(document.body.hasAttribute('aria-busy')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts at the top of the screen and works down', () => {
    document.body.innerHTML = '<p id="top">First line</p><p id="low">First line</p>'
    const [top, low] = [...document.body.querySelectorAll('p')].map((p) => p.firstChild as Text)
    const captured = captureText(document.body, (element) => ({ top: element.id === 'top' ? 0 : window.innerHeight, left: 0 }))
    top!.data = 'Erste Zeile'
    low!.data = 'Erste Zeile'
    playMorph(captured)
    vi.advanceTimersByTime(140)
    expect(top!.data).not.toBe('First line')
    expect(low!.data).toBe('First line')
    vi.advanceTimersByTime(2000)
    expect(low!.data).toBe('Erste Zeile')
  })
})

describe('in the page, through React', () => {
  const held: { value: I18nContextValue | null } = { value: null }
  const i18n = () => held.value!
  function Page() {
    const value = useI18n()
    useEffect(() => {
      held.value = value
    })
    return (
      <main>
        <p data-testid="line">{value.t.hero.statement}</p>
        <p className="sr-only" data-testid="spoken">
          {value.t.hero.statement}
        </p>
      </main>
    )
  }
  const mount = (lang: string) => {
    window.history.replaceState(null, '', `/?lang=${lang}`)
    return render(
      <I18nProvider>
        <Page />
      </I18nProvider>,
    )
  }

  it('is offered only where a browser can do it and a reader has not asked for less motion', () => {
    expect(canMorph()).toBe(false)
    stubBrowser()
    expect(canMorph()).toBe(true)
    stubBrowser({ reducedMotion: true })
    expect(canMorph()).toBe(false)
  })

  it('changes the language at once and shows it letter by letter, with no dim over it', () => {
    stubBrowser()
    const view = mount('en')
    const line = view.getByTestId('line')
    const node = line.firstChild as Text
    act(() => i18n().setLang('de'))
    // The language has changed — state, document, storage — while the page still reads as it did.
    expect(i18n().lang).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    expect(i18n().switching).toBe(false)
    expect(line.textContent).toBe(dictionaries.en.hero.statement)
    // What a screen reader is told was never anything but the answer.
    expect(view.getByTestId('spoken').textContent).toBe(dictionaries.de.hero.statement)

    pass(120)
    expect(line.textContent).not.toBe(dictionaries.en.hero.statement)
    expect(line.textContent).not.toBe(dictionaries.de.hero.statement)
    pass(2000)
    expect(line.textContent).toBe(dictionaries.de.hero.statement)
    // The same node, never replaced: React still owns the page it thinks it does.
    expect(line.firstChild).toBe(node)
    expect(line.childNodes).toHaveLength(1)

    // And React can still write to it.
    act(() => i18n().setLang('ru'))
    pass(2000)
    expect(line.textContent).toBe(dictionaries.ru.hero.statement)
    expect(line.firstChild).toBe(node)
  })

  it('takes a second change in its stride: the first is put down where it was going, and the second starts from there', () => {
    stubBrowser()
    const view = mount('en')
    const line = view.getByTestId('line')
    act(() => i18n().setLang('de'))
    pass(150)
    act(() => i18n().setLang('ru'))
    // Back to whole German, not to a German that was half English.
    expect(line.textContent).toBe(dictionaries.de.hero.statement)
    pass(2000)
    expect(line.textContent).toBe(dictionaries.ru.hero.statement)
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    expect(document.body.hasAttribute('aria-busy')).toBe(false)
  })

  it('leaves the page as React wrote it when the page goes away mid-change', () => {
    stubBrowser()
    const view = mount('en')
    act(() => i18n().setLang('de'))
    pass(100)
    view.unmount()
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    expect(document.body.hasAttribute('aria-busy')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('is simply the new text for a reader who asked for less motion', () => {
    stubBrowser({ reducedMotion: true })
    const view = mount('en')
    act(() => i18n().setLang('de'))
    expect(view.getByTestId('line').textContent).toBe(dictionaries.de.hero.statement)
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
  })
})


describe('where the letters of a text are on the page', () => {
  const said = (ranges: Range[]) => ranges.map((range) => range.toString())

  it('is found by counting letters and not spaces, through as many nodes as the text is in', () => {
    document.body.innerHTML = '<h2><span>Hello</span> <span><i>wor</i><i>ld</i></span><br><span>again</span></h2>'
    const root = document.querySelector('h2')!
    expect(said(rangesWithin(root, 'Hello world again', [[0, 2], [6, 8], [9, 11], [12, 17]]))).toEqual(['He', 'wo', 'ld', 'again'])
    // A run of letters is one range, whatever it runs through.
    expect(said(rangesWithin(root, 'Hello world again', [[6, 11]]))).toEqual(['world'])
    // The text may have its spaces anywhere, or twice over: the letters are the same letters.
    expect(said(rangesWithin(root, 'Hello  world  again', [[7, 12]]))).toEqual(['world'])
    expect(said(rangesWithin(root, ' Helloworldagain', [[1, 6]]))).toEqual(['Hello'])
  })

  it('is nowhere for letters the page does not have, and nothing is thrown looking for them', () => {
    document.body.innerHTML = '<h2><span>Hello</span></h2>'
    const root = document.querySelector('h2')!
    expect(rangesWithin(root, 'Hello', [])).toEqual([])
    expect(said(rangesWithin(root, 'Hello and more', [[6, 9]]))).toEqual([])
    expect(said(rangesWithin(root, 'Hello and more', [[3, 9]]))).toEqual([])
  })
})

/** A heading that is not a text node to write into: it is asked what it says, and told what to say. */
describe('text that lays its own letters out', () => {
  const LAY: Lay = { lines: [1], widest: 300 }
  /** Something that says it writes itself, and remembers everything it was told. */
  function writerOf(element: Element | null, text: { said: string; asked: string; shown?: boolean }) {
    const told = { left: [] as [string, Lay][], said: [] as MorphFrame[], rested: 0 }
    const writer: Writer = {
      element: () => element,
      shown: () => text.shown ?? true,
      said: () => text.said,
      asked: () => text.asked,
      lay: () => LAY,
      leave: (was, lay) => void told.left.push([was, lay]),
      say(step, hot) {
        told.said.push(step)
        text.said = step.text
        return hot.map(() => document.createRange())
      },
      rest: () => void told.rested++,
    }
    return { writer, told, remove: addWriter(writer) }
  }
  const page = (html: string) => {
    document.body.innerHTML = html
    return document.querySelector('[data-morph="own"]')
  }

  it('is captured as what it says and how it lies, and not as the text nodes it is made of', () => {
    const element = page('<p>Plain</p><h2><span data-morph="own"><span>Old</span> <span>words</span></span></h2>')
    const { writer, remove } = writerOf(element, { said: 'Old words', asked: 'Old words' })
    const captured = captureText(document.body, everywhere)
    expect([...captured.keys()][0]).toBe(writer)
    expect([...captured.values()]).toEqual([
      { text: 'Old words', ...ON_SCREEN, lay: LAY },
      { text: 'Plain', ...ON_SCREEN },
    ])
    remove()
    expect([...captureText(document.body, everywhere).values()].map((entry) => entry.text)).toEqual(['Plain'])
  })

  it('is left alone where plain text would be: off screen, not yet shown, under an overlay, or asking to be', () => {
    for (const [html, text, place] of [
      ['<h2><span data-morph="own">Old</span></h2>', { shown: false }, everywhere],
      ['<h2><span data-morph="own">Old</span></h2>', {}, () => null],
      ['<div inert><h2><span data-morph="own">Old</span></h2></div>', {}, everywhere],
      ['<div data-no-morph><h2><span data-morph="own">Old</span></h2></div>', {}, everywhere],
      ['<h2><span data-morph="own">Old</span></h2>', { said: '  ' }, everywhere],
    ] as const) {
      const { remove } = writerOf(page(html), { said: 'Old', asked: 'Old', ...text })
      expect(captureText(document.body, place).size, html).toBe(0)
      remove()
    }
    // One that is not in the page at all — made, and not yet put there.
    const { remove } = writerOf(null, { said: 'Old', asked: 'Old' })
    expect(captureText(document.body, everywhere).size).toBe(0)
    remove()
  })

  it('is told to go back to what it said, then each step of the way, and its lit letters are lit with the rest', () => {
    const lit: unknown[][] = []
    vi.stubGlobal('Highlight', function (this: { ranges: Range[] }, ...ranges: Range[]) {
      this.ranges = ranges
    })
    vi.stubGlobal('CSS', { highlights: { set: (_: string, highlight: { ranges: Range[] }) => void lit.push(highlight.ranges), delete: () => true } })
    const text = { said: 'Let’s build something.', asked: 'Let’s build something.' }
    const { told, remove } = writerOf(page('<h2><span data-morph="own">Let’s build something.</span></h2>'), text)
    const captured = captureText(document.body, everywhere)
    text.asked = 'Lass uns etwas bauen.'
    playMorph(captured)
    // Before anything is painted: what it said, as it lay.
    expect(told.left).toEqual([['Let’s build something.', LAY]])
    expect(told.said).toEqual([])
    text.said = 'Let’s build something.'

    vi.advanceTimersByTime(2500)
    const steps = told.said.map((step) => step.text)
    expect(steps[0]).toBe('Let’s build something.')
    expect(steps[steps.length - 1]).toBe('Lass uns etwas bauen.')
    expect(new Set(steps).size).toBeGreaterThan(10)
    // Word against word: three words until the fourth comes, and each step says how far along each is.
    for (const step of told.said) {
      expect(step.words).toHaveLength(4)
      expect(step.text.split(' ').length).toBeGreaterThanOrEqual(3)
    }
    // What it answered with is what was lit.
    expect(lit.some((ranges) => ranges.length > 0)).toBe(true)
    expect(told.rested).toBe(0)
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    remove()
  })

  it('is told to rest when the change is ended early, and is let go of when it says something else', () => {
    const text = { said: 'Old words here', asked: 'Old words here' }
    const { told, remove } = writerOf(page('<h2><span data-morph="own">Old words here</span></h2>'), text)
    const captured = captureText(document.body, everywhere)
    text.asked = 'New words here now'
    const settle = playMorph(captured)
    vi.advanceTimersByTime(150)
    expect(told.said.length).toBeGreaterThan(1)
    settle()
    expect(told.rested).toBe(1)
    const heard = told.said.length
    vi.advanceTimersByTime(2000)
    expect(told.said).toHaveLength(heard)
    settle()
    expect(told.rested).toBe(1)

    // Again, and this time its owner gives it other text half way.
    text.said = 'Old words here'
    const again = playMorph(captureText(document.body, everywhere))
    vi.advanceTimersByTime(150)
    text.said = 'Newer than either'
    const before = told.said.length
    vi.advanceTimersByTime(2000)
    expect(told.said).toHaveLength(before)
    again()
    expect(told.rested).toBe(1)
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    remove()
  })
})

/** `SplitText`: a heading in masked words, through React, from one language to another. */
describe('a heading in masked words', () => {
  class Unobserved {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  const held: { value: I18nContextValue | null } = { value: null }
  const i18n = () => held.value!
  function Heading({ mode, show = true, name = false }: { mode?: 'words' | 'chars'; show?: boolean; name?: boolean }) {
    const value = useI18n()
    useEffect(() => {
      held.value = value
    })
    return (
      <h2>
        <SplitText text={name ? value.t.hero.firstName : value.t.contact.title} mode={mode} trigger="manual" show={show} />
      </h2>
    )
  }
  const mount = (lang: string, props: Parameters<typeof Heading>[0] = {}) => {
    window.history.replaceState(null, '', `/?lang=${lang}`)
    const view = render(
      <I18nProvider>
        <Heading {...props} />
      </I18nProvider>,
    )
    return { view, root: view.container.querySelector('[data-morph="own"]') as HTMLElement }
  }
  const words = (root: Element) => [...root.children].filter((child) => child.tagName === 'SPAN')
  /** The letters of a word, or of one letter of it: what rises out of the mask. */
  const units = (root: Element) => [...root.querySelectorAll(':scope > span > span > span')] as HTMLElement[]
  /** How many words are on each line it has been told to break into: "2/1" is two, then one. */
  const lines = (root: Element) => {
    const counts = [0]
    for (const child of root.children) {
      if (child.tagName === 'BR') counts.push(0)
      else counts[counts.length - 1]!++
    }
    return counts.join('/')
  }
  const { en, de, ru, uz, oz } = dictionaries

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', Unobserved)
  })

  it('is walked to its translation letter by letter, in the words it rose in, and is its translation to a screen reader from the first', () => {
    stubBrowser()
    const { root } = mount('en')
    const first = words(root)[0]!
    expect(root.textContent).toBe(en.contact.title)
    // Long enough for the last of it to have risen.
    pass(1500)

    act(() => i18n().setLang('de'))
    // The answer at once, for whoever is read it; on the page, still what it said.
    expect(root.getAttribute('aria-label')).toBe(de.contact.title)
    expect(root.textContent).toBe(en.contact.title)
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(true)

    const seen = new Set<string>()
    for (let elapsed = 0; elapsed < 2500; elapsed += 16) {
      pass(16)
      seen.add(root.textContent!)
      expect(root.getAttribute('aria-label')).toBe(de.contact.title)
      // The same first word, never made again: it rose once.
      expect(words(root)[0]).toBe(first)
    }
    expect(seen.size).toBeGreaterThan(10)
    expect(root.textContent).toBe(de.contact.title)
    expect(words(root)).toHaveLength(4)
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    // As a visit in that language has it: nothing left of the way there.
    expect(root.querySelector('br')).toBeNull()
    expect(root.className).not.toContain('whitespace-nowrap')
    // The word the translation added did not make an entrance: it has no place under its mask to rise from.
    expect(units(root)[3]!.style.transform).not.toContain('115%')
  })

  it('brings what it gains up with the rest when the language changes while it is still rising', () => {
    stubBrowser()
    const { root } = mount('en')
    // A tenth of a second into a rise that takes a second.
    pass(100)
    act(() => i18n().setLang('de'))
    pass(2500)
    expect(root.textContent).toBe(de.contact.title)
    // The fourth word was made under its mask, like the three it joined, to come up after them.
    expect(units(root)).toHaveLength(4)
    expect(units(root)[3]!.style.transform).toContain('115%')
  })

  it('is given its lines while it changes, each break moved once, and left to fall when it is over', () => {
    stubBrowser()
    // Where each word stands, for a page that lays nothing out: English in two lines, German in three.
    const top: Record<string, number> = { 'Let’s': 0, build: 0, 'something.': 80, Lass: 0, uns: 80, etwas: 80, 'bauen.': 160 }
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return top[this.textContent ?? ''] ?? 0
    })
    const { root } = mount('en')
    expect(lines(root)).toBe('3')

    act(() => i18n().setLang('de'))
    // What it said, lying as it lay, and breaking nowhere else.
    expect(root.textContent).toBe(en.contact.title)
    expect(lines(root)).toBe('2/1')
    expect(root.className).toContain('whitespace-nowrap')

    const seen = [lines(root)]
    for (let elapsed = 0; elapsed < 2500; elapsed += 16) {
      pass(16)
      if (seen[seen.length - 1] !== lines(root)) seen.push(lines(root))
    }
    // The second word drops and the third comes up to it in one move; the fourth comes on a line of its own; then it is let go.
    expect(seen).toEqual(['2/1', '1/2', '1/2/1', '4'])
    expect(root.className).not.toContain('whitespace-nowrap')
  })

  it('is simply given its new text while it is still under its masks', () => {
    stubBrowser()
    const { root } = mount('en', { show: false })
    act(() => i18n().setLang('de'))
    expect(root.textContent).toBe(de.contact.title)
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    expect(root.className).not.toContain('whitespace-nowrap')
    // The word it gained waits under its mask with the rest, to rise with them.
    expect(units(root)).toHaveLength(4)
    for (const unit of units(root)) expect(unit.style.transform).toContain('115%')
  })

  it('in letters each in its own mask turns over only the spellings that differ between the two alphabets', () => {
    stubBrowser()
    // What is lit, each time it is said: the letters of the name among them.
    let lit: Range[] = []
    vi.stubGlobal('Highlight', function (this: { ranges: Range[] }, ...ranges: Range[]) {
      this.ranges = ranges
    })
    vi.stubGlobal('CSS', { highlights: { set: (_: string, highlight: { ranges: Range[] }) => void (lit = highlight.ranges), delete: () => void (lit = []) } })
    const { root } = mount('uz', { mode: 'chars', name: true })
    const first = units(root)[0]!
    expect(units(root)).toHaveLength(10)
    act(() => i18n().setLang('oz'))
    const seen = [root.textContent]
    const glowing: string[] = []
    for (let elapsed = 0; elapsed < 1500; elapsed += 16) {
      pass(16)
      if (seen[seen.length - 1] !== root.textContent) seen.push(root.textContent)
      const here = lit.filter((range) => root.contains(range.startContainer)).map((range) => range.toString())
      if (root.textContent === oz.hero.firstName && here.length) glowing.push(here.join())
    }
    // "sh" is "ş" in one go: nothing was ever on the page that is in neither alphabet.
    expect(seen).toEqual([uz.hero.firstName, oz.hero.firstName])
    expect(units(root)).toHaveLength(9)
    expect(units(root)[0]).toBe(first)
    // And the letter that turned over stays lit for its while, though the name was all there the moment it did.
    expect(new Set(glowing)).toEqual(new Set(['ş']))
    expect(glowing.length).toBeGreaterThan(4)
    expect(lit).toEqual([])
  })

  it('takes a second change in its stride: put down as the whole of the first, and walked on from there', () => {
    stubBrowser()
    const { root } = mount('en')
    act(() => i18n().setLang('de'))
    pass(150)
    expect(root.textContent).not.toBe(en.contact.title)
    expect(root.textContent).not.toBe(de.contact.title)
    act(() => i18n().setLang('ru'))
    expect(root.getAttribute('aria-label')).toBe(ru.contact.title)
    expect(root.textContent).toBe(de.contact.title)
    pass(2500)
    expect(root.textContent).toBe(ru.contact.title)
    expect(root.querySelector('br')).toBeNull()
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    expect(document.body.hasAttribute('aria-busy')).toBe(false)
  })

  it('leaves nothing running, and nothing listening, when the page goes away mid-change', () => {
    stubBrowser()
    const { view } = mount('en')
    act(() => i18n().setLang('de'))
    pass(100)
    view.unmount()
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    document.body.innerHTML = '<p>Plain</p>'
    expect(captureText(document.body, everywhere).size).toBe(1)
  })

  it('is simply its translation for a reader who asked for less motion', () => {
    stubBrowser({ reducedMotion: true })
    const { root } = mount('en')
    act(() => i18n().setLang('de'))
    expect(root.textContent).toBe(de.contact.title)
    expect(root.getAttribute('aria-label')).toBe(de.contact.title)
    expect(document.documentElement.hasAttribute(MORPHING)).toBe(false)
    expect(root.className).not.toContain('whitespace-nowrap')
  })
})
