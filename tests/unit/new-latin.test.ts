import { afterEach, describe, expect, it, vi } from 'vitest'
import { HREFLANG, LOCALE_TAGS, OG_LOCALE, dictionaries } from '@/i18n/context'
import { LANGUAGES, LANGUAGE_LABELS } from '@/i18n/types'
import { LOANWORDS, NEW_LATIN_ALPHABET, NEW_LATIN_TAG, respell, toNewLatin } from '@/i18n/newLatin'
import { formatRelative } from '@/lib/format'
import { leaves } from './dictionary'

/**
 * Uzbek in the new Latin alphabet is `uz` respelled by a function. These hold
 * the function to the alphabet's rules, and the result to the alphabet.
 */

/** Language names are each in their own language and stay out of this. */
const foreign = (path: string) => path.startsWith('language.names')
const LOAN = new RegExp(`\\b(?:${LOANWORDS.join('|')})`, 'g')
const OLD_SPELLING = /[sc]h|[og][ʻʼ‘’'`]/i

describe('toNewLatin', () => {
  it('respells the four letters that changed, keeping case', () => {
    expect(toNewLatin('O‘zbekiston')).toBe('Özbekiston')
    expect(toNewLatin('ko‘rish')).toBe('köriş')
    expect(toNewLatin('G‘oya')).toBe('Ğoya')
    expect(toNewLatin('bog‘lanish')).toBe('boğlaniş')
    expect(toNewLatin('Shahar')).toBe('Şahar')
    expect(toNewLatin('SHAXSIY')).toBe('ŞAXSIY')
    expect(toNewLatin('Chiroq')).toBe('Çiroq')
    expect(toNewLatin('ishonch')).toBe('işonç')
    // ş followed by a real h, as in the old spelling.
    expect(toNewLatin('mashhur')).toBe('maşhur')
  })

  it('accepts every apostrophe people type for oʻ and gʻ', () => {
    for (const mark of ['ʻ', '‘', '’', "'", '`', 'ʼ']) expect(toNewLatin(`o${mark}g${mark}il`), mark).toBe('öğil')
  })

  it('changes nothing else', () => {
    // "ng" stays two letters; the tutuq belgisi stays; names, code and marks stay.
    for (const same of [
      'tong',
      'ma’lumot',
      'Is’hoq',
      'Haydarov',
      '2021-yildan',
      'Flutter, Python, React',
      'Русский',
      'https://t.me/torex_dev',
      'Torex.box("name").put(key, value)',
    ]) {
      expect(toNewLatin(same)).toBe(same)
    }
  })

  it('leaves loanwords in their own spelling, Uzbek suffix included', () => {
    expect(toNewLatin('dvigatelni benchmark qiladigan')).toBe('dvigatelni benchmark qiladigan')
    expect(toNewLatin('benchmarkchi')).toBe('benchmarkçi')
  })

  it('is idempotent, so respelled text can safely pass through again', () => {
    for (const { path, value } of leaves(dictionaries.uz)) {
      const once = toNewLatin(value)
      expect(toNewLatin(once), path).toBe(once)
    }
  })

  it('writes only letters of the alphabet when the input is Uzbek', () => {
    const letters = new Set([...NEW_LATIN_ALPHABET, ...NEW_LATIN_ALPHABET.toLowerCase()])
    const sample = toNewLatin('Men g‘oyalarni haqiqiy mahsulotlarga aylantiraman. Qo‘qon, O‘zbekiston. Ishonchli, tushunarli, chuqur.')
    for (const letter of sample.match(/\p{L}/gu) ?? []) expect(letters.has(letter), letter).toBe(true)
  })
})

describe('the oz dictionary', () => {
  const all = leaves(dictionaries.oz)

  it('is uz, respelled', () => {
    expect(dictionaries.oz.meta.title).toBe('Dilşodjon Haydarov — Dasturçi · Ijodkor · Bunyodkor')
    expect(dictionaries.oz.common.location).toBe('Qöqon, Özbekiston')
    expect(dictionaries.oz.common.name).toBe('Dilşodjon Haydarov')
  })

  it('keeps the language names in their own languages', () => {
    expect(dictionaries.oz.language.names).toEqual(dictionaries.uz.language.names)
    expect(dictionaries.oz.language.names.uz).toBe('O‘zbek')
    expect(dictionaries.oz.language.names.oz).toBe('Özbek (yangi alifbo)')
  })

  it('has no 1995 spelling left, loanwords aside', () => {
    // A failure here is usually a foreign word that belongs in LOANWORDS.
    for (const { path, value } of all) {
      if (foreign(path)) continue
      expect(value.replace(LOAN, ''), path).not.toMatch(OLD_SPELLING)
    }
  })

  it('labels its button in its own alphabet', () => {
    expect(LANGUAGE_LABELS.oz).toBe('ÖZ')
    for (const lang of LANGUAGES) expect(LANGUAGE_LABELS[lang], lang).toMatch(/^[A-ZÖ]{2}$/)
  })
})

describe('the oz locale', () => {
  afterEach(() => vi.useRealTimers())

  it('is a tag Intl accepts and resolves to Uzbek Latin', () => {
    expect(LOCALE_TAGS.oz).toBe(NEW_LATIN_TAG)
    expect(Intl.getCanonicalLocales(NEW_LATIN_TAG)).toEqual([NEW_LATIN_TAG])
    expect(new Intl.RelativeTimeFormat(NEW_LATIN_TAG).resolvedOptions().locale).toBe('uz-Latn-UZ')
  })

  it('respells what Intl says, which it only knows in the old alphabet', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    expect(formatRelative('2026-06-14T12:00:00Z', LOCALE_TAGS.uz)).toBe('kecha')
    expect(formatRelative('2026-06-14T12:00:00Z', LOCALE_TAGS.oz)).toBe('keça')
    expect(formatRelative('2026-05-10T12:00:00Z', LOCALE_TAGS.oz)).toBe('ötgan oy')
    expect(respell(LOCALE_TAGS.en, 'kecha')).toBe('kecha')
  })

  it('holds the one Uzbek hreflang, as the default, and shares og:locale with uz', () => {
    expect(HREFLANG.oz).toBe('uz-Latn')
    expect(HREFLANG.uz).toBeUndefined()
    expect(OG_LOCALE.oz).toBe(OG_LOCALE.uz)
  })
})
