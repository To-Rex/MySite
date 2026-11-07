import { describe, expect, it } from 'vitest'
import { LOCALE_TAGS, dictionaries } from '@/i18n/context'
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '@/i18n/types'

/**
 * What the `Dictionary` type cannot check.
 *
 * The type guarantees every key exists in every language. It says nothing about
 * an empty string, a list one language has four items of and another three, or
 * a project described in English and still "coming soon" in Uzbek — all of
 * which compile, and all of which show up on the page.
 */

type Leaf = { path: string; value: string }

function leaves(node: unknown, path = ''): Leaf[] {
  if (typeof node === 'string') return [{ path, value: node }]
  if (Array.isArray(node)) return node.flatMap((item, i) => leaves(item, `${path}[${i}]`))
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => leaves(value, path ? `${path}.${key}` : key))
  }
  throw new Error(`unexpected ${typeof node} at ${path}`)
}

/** A project description is the one string allowed to be empty: "not written yet". */
const mayBeEmpty = (path: string) => /^projects\.items\.[^.]+\.description$/.test(path)

/**
 * Search keywords are the one list that is not a translation of the others:
 * what people type differs by language, so how many there are may too.
 */
const shape = (all: Leaf[]) => all.map((leaf) => leaf.path).filter((path) => !path.startsWith('meta.keywords['))

const reference = shape(leaves(dictionaries[DEFAULT_LANGUAGE]))

describe.each(LANGUAGES)('%s dictionary', (lang: Language) => {
  const all = leaves(dictionaries[lang])

  it('has the same shape as the default language, list lengths included', () => {
    expect(shape(all)).toEqual(reference)
  })

  it('leaves no string empty or padded', () => {
    for (const { path, value } of all) {
      if (!mayBeEmpty(path)) expect(value, path).not.toBe('')
      expect(value, path).toBe(value.trim())
    }
  })

  it('has metadata a search result can actually show', () => {
    const { meta } = dictionaries[lang]
    // Longer than this and a results page cuts it mid-sentence.
    expect(meta.title.length).toBeLessThanOrEqual(70)
    expect(meta.description.length).toBeGreaterThanOrEqual(50)
    expect(meta.description.length).toBeLessThanOrEqual(200)
    expect(meta.ogDescription.length).toBeLessThanOrEqual(200)
    expect(meta.keywords.length).toBeGreaterThan(0)
  })

  it('has a locale tag Intl accepts', () => {
    expect(() => new Intl.DateTimeFormat(LOCALE_TAGS[lang])).not.toThrow()
    expect(Intl.getCanonicalLocales(LOCALE_TAGS[lang])).toHaveLength(1)
  })
})

describe('project copy', () => {
  const ids = Object.keys(dictionaries[DEFAULT_LANGUAGE].projects.items) as (keyof (typeof dictionaries)['uz']['projects']['items'])[]

  it.each(ids)('%s is described in every language or in none', (id) => {
    const described = LANGUAGES.filter((lang) => dictionaries[lang].projects.items[id].description !== '')
    // Half-translated is the state to catch: one visitor reads about the project,
    // the next is told the details are coming soon.
    expect([0, LANGUAGES.length], `described only in: ${described.join(', ')}`).toContain(described.length)
  })
})
