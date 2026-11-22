import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './types'
import { I18nContext, LOCALE_TAGS, dictionaries, isLanguage, type I18nContextValue } from './context'
import { storage } from '@/lib/storage'
import { canMorph, captureText, playMorph, type Captured } from './letterMorph'

/**
 * Where an explicit choice — a click on the switcher — is remembered. Only
 * that: a language the page merely resolved, from `?lang=`, the browser or the
 * default, is not stored, so a change of default reaches everyone who never
 * chose. The key is new because the old one (`dh.lang`) was written with
 * resolved languages too, which would have pinned every earlier visitor to the
 * old alphabet; it is cleared on the first visit after this.
 */
export const LANGUAGE_CHOICE_KEY = 'dh.lang.choice'
const LEGACY_KEY = 'dh.lang'

/** Resolution order: ?lang= query → remembered choice → browser languages → default (oz). */
function resolveInitialLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE
  const fromQuery = new URLSearchParams(window.location.search).get('lang')
  if (isLanguage(fromQuery)) return fromQuery
  const stored = storage.get(LANGUAGE_CHOICE_KEY)
  if (isLanguage(stored)) return stored
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0]
    // The first of ours in that language: for "uz", whatever its script, the new alphabet.
    const match = LANGUAGES.find((lang) => LOCALE_TAGS[lang].toLowerCase().split('-')[0] === base)
    if (match) return match
  }
  return DEFAULT_LANGUAGE
}

/** The two spellings of one language: between them a letter turns over where it stands. */
const UZBEK: readonly Language[] = ['uz', 'oz']

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(resolveInitialLanguage)
  const [switching, setSwitching] = useState(false)
  const timer = useRef<number | null>(null)
  /** What was on screen when the language was last changed, until React has put the new text in. */
  const leaving = useRef<{ captured: Map<Text, Captured>; flip: boolean } | null>(null)
  /** Ends a change that is still on its way. */
  const settle = useRef<(() => void) | null>(null)

  useEffect(() => {
    document.documentElement.lang = LOCALE_TAGS[lang]
  }, [lang])

  useEffect(() => storage.remove(LEGACY_KEY), [])

  const setLang = useCallback(
    (next: Language) => {
      if (next === lang) return
      // A change still on its way is put down where it was going: the next one starts from there.
      settle.current?.()
      settle.current = null
      // Swap immediately — correctness (state, persistence) never waits on what
      // is shown. Where the page can, each visible string then turns into its
      // translation letter by letter; where it cannot, the page dims over the
      // swap instead. Never both: they would only hide each other.
      if (canMorph()) {
        leaving.current = { captured: captureText(), flip: UZBEK.includes(lang) && UZBEK.includes(next) }
      } else {
        leaving.current = null
        setSwitching(true)
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setSwitching(false), 240)
      }
      setLangState(next)
      storage.set(LANGUAGE_CHOICE_KEY, next)
    },
    [lang],
  )

  // After React has written the new language into the page, and before the
  // browser paints it: the one moment the old text can be put back unseen.
  useLayoutEffect(() => {
    const change = leaving.current
    leaving.current = null
    if (change) settle.current = playMorph(change.captured, { flip: change.flip })
  }, [lang])

  useEffect(
    () => () => {
      settle.current?.()
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )

  const value = useMemo<I18nContextValue>(
    () => ({ lang, t: dictionaries[lang], locale: LOCALE_TAGS[lang], setLang, switching }),
    [lang, setLang, switching],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
