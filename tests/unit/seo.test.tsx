// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Seo } from '@/components/seo/Seo'
import { site } from '@/config/site'
import { I18nProvider } from '@/i18n/I18nProvider'
import { HREFLANG, OG_LOCALE, dictionaries, useI18n, type I18nContextValue } from '@/i18n/context'
import { LANGUAGES } from '@/i18n/types'

// `oz` shares uz-Latn and uz_UZ with `uz`, so it adds no alternate of either kind.
const ALTERNATES = Object.keys(HREFLANG).length
const OG_ALTERNATES = new Set(Object.values(OG_LOCALE)).size - 1

/**
 * `index.html` and <Seo> both describe the page, for two different audiences:
 * the static tags for crawlers that never run JavaScript — every link-preview
 * bot — and the component for everyone after React mounts. They are written
 * separately, so they can drift, and a drifted tag is invisible: the page looks
 * right in a browser while a shared link shows last month's description.
 */

/** The <head> exactly as built: the site URL placeholder filled in, as Vite fills it. */
const builtHead = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
  .replaceAll('%VITE_SITE_URL%', site.url)
  .match(/<head>([\s\S]*)<\/head>/)![1]!

function describeHead() {
  const head = document.head
  const metas = [...head.querySelectorAll('meta[name], meta[property]')].map((meta) => {
    const kind = meta.hasAttribute('name') ? 'name' : 'property'
    return `${kind}:${meta.getAttribute(kind)} = ${meta.getAttribute('content')}`
  })
  const links = [...head.querySelectorAll('link[rel="canonical"], link[rel="alternate"]')].map(
    (link) => `${link.getAttribute('rel')}[${link.getAttribute('hreflang') ?? ''}] = ${link.getAttribute('href')}`,
  )
  const structured = Object.fromEntries(
    [...head.querySelectorAll('script[type="application/ld+json"]')].map((script) => [script.id, JSON.parse(script.textContent ?? '')]),
  )
  return { title: head.querySelector('title')?.textContent, metas: metas.sort(), links: links.sort(), structured }
}

/** The provider's value, handed out of the tree so a test can call `setLang`. */
const captured: { value: I18nContextValue | null } = { value: null }
const i18n = () => captured.value!
function Capture() {
  const value = useI18n()
  useEffect(() => {
    captured.value = value
  })
  return null
}

function mount(url: string) {
  window.history.replaceState(null, '', url)
  return render(
    <I18nProvider>
      <Seo />
      <Capture />
    </I18nProvider>,
  )
}

const count = (selector: string) => document.head.querySelectorAll(selector).length
const content = (selector: string) => document.head.querySelector(selector)?.getAttribute('content')

beforeEach(() => {
  localStorage.clear()
  document.head.innerHTML = builtHead
})
afterEach(cleanup)

describe('static head', () => {
  it('has no placeholder left once the site URL is filled in', () => {
    expect(builtHead).not.toMatch(/%[A-Z_]+%/)
  })

  it('is exactly what <Seo> writes for the default language', () => {
    const shipped = describeHead()
    mount('/?lang=uz')
    // Not "contains": equal. A tag added to one side and not the other fails here.
    expect(describeHead()).toEqual(shipped)
  })

  it('gives a link preview everything it needs, as absolute URLs', () => {
    for (const property of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'og:site_name']) {
      expect(content(`meta[property="${property}"]`), property).toBeTruthy()
    }
    expect(content('meta[property="og:image"]')).toBe(`${site.url}/og.png`)
    expect(content('meta[name="twitter:card"]')).toBe('summary_large_image')
    expect(content('meta[name="twitter:image"]')).toBe(`${site.url}/og.png`)
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${site.url}/`)
  })

  it('carries the default-language copy from the dictionary', () => {
    const { meta } = dictionaries.uz
    expect(document.head.querySelector('title')?.textContent).toBe(meta.title)
    expect(content('meta[name="description"]')).toBe(meta.description)
    expect(content('meta[property="og:title"]')).toBe(meta.ogTitle)
    expect(content('meta[property="og:description"]')).toBe(meta.ogDescription)
  })

  it('lists every social profile in the structured data', () => {
    const person = JSON.parse(document.getElementById('ld-person')!.textContent!) as { sameAs: string[] }
    expect(person.sameAs.sort()).toEqual(Object.values(site.social).sort())
  })
})

describe('<Seo>', () => {
  it('adopts the static tags instead of adding a second set', () => {
    mount('/?lang=uz')
    for (const selector of [
      'title',
      'meta[name="description"]',
      'meta[property="og:title"]',
      'meta[property="og:image"]',
      'meta[name="twitter:card"]',
      'link[rel="canonical"]',
      '#ld-person',
      '#ld-website',
    ]) {
      expect(count(selector), selector).toBe(1)
    }
    expect(count('link[rel="alternate"]')).toBe(ALTERNATES + 1)
    expect(count('meta[property="og:locale:alternate"]')).toBe(OG_ALTERNATES)
  })

  it.each(LANGUAGES)('rewrites the head in place when the language becomes %s', (lang) => {
    mount('/?lang=uz')
    act(() => i18n().setLang(lang))
    const { meta } = dictionaries[lang]
    expect(document.title).toBe(meta.title)
    expect(content('meta[name="description"]')).toBe(meta.description)
    expect(content('meta[property="og:title"]')).toBe(meta.ogTitle)
    expect(content('meta[name="twitter:description"]')).toBe(meta.ogDescription)
    expect(content('meta[property="og:url"]')).toBe(lang === 'uz' ? `${site.url}/` : `${site.url}/?lang=${lang}`)
    expect((JSON.parse(document.getElementById('ld-person')!.textContent!) as { jobTitle: string }).jobTitle).toBe(meta.jobTitle)
    // Still one of each, however many times the language has changed.
    expect(count('meta[property="og:title"]')).toBe(1)
    expect(count('link[rel="canonical"]')).toBe(1)
    expect(count('script[type="application/ld+json"]')).toBe(2)
    expect(count('meta[property="og:locale:alternate"]')).toBe(OG_ALTERNATES)
  })

  it('builds the whole head from nothing when there is no static copy', () => {
    document.head.innerHTML = ''
    mount('/?lang=en')
    expect(document.title).toBe(dictionaries.en.meta.title)
    expect(content('meta[property="og:image"]')).toBe(`${site.url}/og.png`)
    expect(count('link[rel="alternate"]')).toBe(ALTERNATES + 1)
    expect(count('script[type="application/ld+json"]')).toBe(2)
  })
})
