import type { Dictionary } from './types'

/**
 * Uzbek in the new Latin alphabet (28 letters):
 *
 *   A B D E F G Ğ H I J K L M N O Ö P Q R S Ş Ç T U V X Y Z
 *
 * Against the 1995 alphabet four spellings change — Oʻ→Ö, Gʻ→Ğ, Sh→Ş, Ch→Ç —
 * and nothing else does: "ng" stays two letters, the tutuq belgisi (ʼ) stays,
 * every other letter is the same. That makes the new alphabet a function of the
 * old one, so the `oz` dictionary is not written by hand: it is `uz` passed
 * through `respellDictionary`. Edit `uz.ts`; `oz` follows.
 */
export const NEW_LATIN_ALPHABET = 'ABDEFGĞHIJKLMNOÖPQRSŞÇTUVXYZ'

/**
 * BCP-47 tag for the new orthography. No variant subtag is registered for it,
 * so a private-use one tells it apart from `uz-Latn-UZ`; Intl ignores the
 * private part and formats with the uz-Latn data, which `respell` then fixes.
 */
export const NEW_LATIN_TAG = 'uz-Latn-UZ-x-yangi'

export const isNewLatin = (locale: string): boolean => locale === NEW_LATIN_TAG

/**
 * Words inside Uzbek copy that are not Uzbek and keep their own spelling.
 * Matched whole and case-sensitively. Add to this list, not to `oz`.
 */
export const LOANWORDS = ['benchmark'] as const

/** Dictionary paths whose strings are each in their own language, not in Uzbek. */
const FOREIGN_PATHS = ['language.names']

// Any of the apostrophe-like characters people type for oʻ and gʻ.
const TURNED_COMMA = "[ʻʼ‘’'`]"
const RULES: [RegExp, (match: string) => string][] = [
  [new RegExp(`[Oo]${TURNED_COMMA}`, 'g'), (m) => (m[0] === 'O' ? 'Ö' : 'ö')],
  [new RegExp(`[Gg]${TURNED_COMMA}`, 'g'), (m) => (m[0] === 'G' ? 'Ğ' : 'ğ')],
  // The first letter decides the case, so "Sh", "SH" and "sh" all come out right.
  [/[Ss][Hh]/g, (m) => (m[0] === 'S' ? 'Ş' : 'ş')],
  [/[Cc][Hh]/g, (m) => (m[0] === 'C' ? 'Ç' : 'ç')],
]

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// A capturing group, so `split` keeps the loanwords as their own segments. No
// closing boundary: an Uzbek suffix attaches straight on ("benchmarkchi").
const KEEP = new RegExp(`(\\b(?:${LOANWORDS.map(escape).join('|')}))`)

/** Respells one text from the 1995 Latin alphabet into the new one. */
export function toNewLatin(text: string): string {
  return text
    .split(KEEP)
    .map((segment, i) => (i % 2 ? segment : RULES.reduce((acc, [pattern, to]) => acc.replace(pattern, to), segment)))
    .join('')
}

/** Text that Intl produced for `locale`: respelled when the locale is the new alphabet. */
export function respell(locale: string, text: string): string {
  return isNewLatin(locale) ? toNewLatin(text) : text
}

/** The whole `uz` dictionary, respelled, with the same shape. */
export function respellDictionary(dictionary: Dictionary): Dictionary {
  const walk = (node: unknown, path: string): unknown => {
    if (typeof node === 'string') return FOREIGN_PATHS.some((p) => path === p || path.startsWith(`${p}.`)) ? node : toNewLatin(node)
    if (Array.isArray(node)) return node.map((item, i) => walk(item, `${path}[${i}]`))
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value, path ? `${path}.${key}` : key)]))
    }
    return node
  }
  return walk(dictionary, '') as Dictionary
}
