// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/I18nProvider'
import { dictionaries, useI18n, type I18nContextValue } from '@/i18n/context'
import { MORPHING, canMorph, captureText, playMorph } from '@/i18n/letterMorph'

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
