import { createContext, useContext } from 'react'
import { LANGUAGES, type Dictionary, type Language } from './types'
import { uz } from './locales/uz'
import { en } from './locales/en'
import { de } from './locales/de'
import { ru } from './locales/ru'

export const dictionaries: Record<Language, Dictionary> = { uz, en, de, ru }

/** BCP-47 locale per language (used for Intl formatting & html[lang]). */
export const LOCALE_TAGS: Record<Language, string> = {
  uz: 'uz-Latn-UZ',
  en: 'en',
  de: 'de',
  ru: 'ru',
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

export interface I18nContextValue {
  lang: Language
  /** The full dictionary for the active language. */
  t: Dictionary
  /** BCP-47 tag for Intl APIs. */
  locale: string
  setLang: (next: Language) => void
  /** True during the brief crossfade while the language changes. */
  switching: boolean
}

export const I18nContext = createContext<I18nContextValue | null>(null)

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>')
  return ctx
}

