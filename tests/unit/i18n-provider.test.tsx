// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider, LANGUAGE_CHOICE_KEY } from '@/i18n/I18nProvider'
import { LOCALE_TAGS, dictionaries, useI18n, type I18nContextValue } from '@/i18n/context'

/** The provider's value, handed out of the tree so a test can read and drive it. */
const captured: { value: I18nContextValue | null } = { value: null }
const i18n = () => captured.value!
function Capture() {
  const value = useI18n()
  useEffect(() => {
    captured.value = value
  })
  return <p>{value.t.nav.about}</p>
}

function mount({ url = '/', stored, browser = ['fr-FR'] }: { url?: string; stored?: string; browser?: string[] } = {}) {
  window.history.replaceState(null, '', url)
  if (stored) localStorage.setItem(LANGUAGE_CHOICE_KEY, stored)
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(browser)
  return render(
    <I18nProvider>
      <Capture />
    </I18nProvider>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('initial language', () => {
  it('is Uzbek in the new alphabet when nothing says otherwise', () => {
    mount()
    expect(i18n().lang).toBe('oz')
  })

  it.each(['uz', 'uz-Latn-UZ', 'uz-Cyrl-UZ'])('serves a browser asking for %s the new alphabet', (tag) => {
    mount({ browser: [tag, 'ru-RU'] })
    expect(i18n().lang).toBe('oz')
  })

  it("follows the browser's languages, in the visitor's order of preference", () => {
    mount({ browser: ['fr-FR', 'de-AT', 'en-US'] })
    expect(i18n().lang).toBe('de')
  })

  it('prefers a remembered choice to the browser', () => {
    mount({ stored: 'ru', browser: ['en-US'] })
    expect(i18n().lang).toBe('ru')
  })

  it('prefers ?lang= to everything — it is how a translated link is shared', () => {
    mount({ url: '/?lang=en', stored: 'ru', browser: ['de-DE'] })
    expect(i18n().lang).toBe('en')
  })

  it('ignores a language it does not have, wherever it came from', () => {
    mount({ url: '/?lang=xx', stored: 'klingon', browser: ['ja-JP'] })
    expect(i18n().lang).toBe('oz')
  })

  it('remembers only what was chosen, never what it merely resolved', () => {
    mount({ url: '/?lang=en', browser: ['de-DE'] })
    expect(i18n().lang).toBe('en')
    expect(localStorage.getItem(LANGUAGE_CHOICE_KEY)).toBeNull()
  })

  it('forgets the old key, which was written for every visitor, chosen or not', () => {
    localStorage.setItem('dh.lang', 'uz')
    mount()
    expect(i18n().lang).toBe('oz')
    expect(localStorage.getItem('dh.lang')).toBeNull()
  })
})

describe('switching language', () => {
  it('swaps the dictionary, the document language and the stored choice at once', () => {
    const view = mount({ url: '/?lang=uz' })
    expect(view.container.textContent).toBe(dictionaries.uz.nav.about)
    expect(document.documentElement.lang).toBe(LOCALE_TAGS.uz)

    act(() => i18n().setLang('de'))
    expect(view.container.textContent).toBe(dictionaries.de.nav.about)
    expect(i18n().locale).toBe(LOCALE_TAGS.de)
    expect(document.documentElement.lang).toBe(LOCALE_TAGS.de)
    expect(localStorage.getItem(LANGUAGE_CHOICE_KEY)).toBe('de')
  })

  it('dims only briefly, and never delays the swap itself', () => {
    vi.useFakeTimers()
    mount({ url: '/?lang=uz' })
    act(() => i18n().setLang('en'))
    expect(i18n().lang).toBe('en')
    expect(i18n().switching).toBe(true)
    act(() => vi.advanceTimersByTime(300))
    expect(i18n().switching).toBe(false)
  })

  it('does nothing when asked for the language already showing', () => {
    mount({ url: '/?lang=uz' })
    act(() => i18n().setLang('uz'))
    expect(i18n().switching).toBe(false)
  })
})
