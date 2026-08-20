import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_LANGUAGE, type Language } from './types'
import { I18nContext, LOCALE_TAGS, dictionaries, isLanguage, type I18nContextValue } from './context'
import { storage } from '@/lib/storage'

const STORAGE_KEY = 'dh.lang'

/** Resolution order: ?lang= query → persisted choice → browser languages → default (uz). */
function resolveInitialLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE
  const fromQuery = new URLSearchParams(window.location.search).get('lang')
  if (isLanguage(fromQuery)) return fromQuery
  const stored = storage.get(STORAGE_KEY)
  if (isLanguage(stored)) return stored
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLanguage(base)) return base
  }
  return DEFAULT_LANGUAGE
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(resolveInitialLanguage)
  const [switching, setSwitching] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    document.documentElement.lang = LOCALE_TAGS[lang]
    storage.set(STORAGE_KEY, lang)
  }, [lang])

  const setLang = useCallback(
    (next: Language) => {
      if (next === lang) return
      // Swap immediately — correctness (state, persistence) never waits on a timer.
      // The timer only lifts the brief visual dim of the crossfade.
      setSwitching(true)
      setLangState(next)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setSwitching(false), 240)
    },
    [lang],
  )

  useEffect(
    () => () => {
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
