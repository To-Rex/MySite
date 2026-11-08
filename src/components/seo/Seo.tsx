import { useEffect } from 'react'
import { HREFLANG, OG_LOCALE, useI18n } from '@/i18n/context'
import { DEFAULT_LANGUAGE, LANGUAGES } from '@/i18n/types'
import { site } from '@/config/site'
import { technologies } from '@/content/technologies'

/** The languages with an hreflang of their own, in order. */
const ALTERNATES = LANGUAGES.flatMap((l) => {
  const hreflang = HREFLANG[l]
  return hreflang ? [{ lang: l, hreflang }] : []
})

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function upsertLink(rel: string, href: string, hreflang?: string) {
  const selector = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]`
  let el = document.head.querySelector<HTMLLinkElement>(selector)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    if (hreflang) el.hreflang = hreflang
    document.head.appendChild(el)
  }
  el.href = href
}

function upsertJsonLd(id: string, data: unknown) {
  let el = document.getElementById(id) as HTMLScriptElement | null
  if (!el) {
    el = document.createElement('script')
    el.type = 'application/ld+json'
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(data)
}

/**
 * Localized document metadata: title, description, canonical, hreflang alternates,
 * Open Graph / Twitter cards and Person structured data. Runs on every language change.
 *
 * `index.html` carries the same tags, written out for the default language, for
 * the crawlers that never run this. Every helper here updates a tag in place if
 * it is already there, so the static copy is adopted rather than duplicated —
 * and `tests/unit/seo.test.tsx` holds the two to each other: add a tag here and
 * it has to be added there.
 */
export function Seo() {
  const { t, lang } = useI18n()

  useEffect(() => {
    const base = site.url
    const canonical = `${base}/`
    const ogImage = `${base}/og.png`

    document.title = t.meta.title
    upsertMeta('name', 'description', t.meta.description)
    upsertMeta('name', 'keywords', t.meta.keywords.join(', '))
    upsertMeta('name', 'author', site.name)

    upsertLink('canonical', canonical)
    ALTERNATES.forEach(({ lang: l, hreflang }) => upsertLink('alternate', `${base}/?lang=${l}`, hreflang))
    upsertLink('alternate', canonical, 'x-default')

    upsertMeta('property', 'og:type', 'website')
    upsertMeta('property', 'og:site_name', site.name)
    upsertMeta('property', 'og:title', t.meta.ogTitle)
    upsertMeta('property', 'og:description', t.meta.ogDescription)
    upsertMeta('property', 'og:url', lang === DEFAULT_LANGUAGE ? canonical : `${base}/?lang=${lang}`)
    upsertMeta('property', 'og:image', ogImage)
    upsertMeta('property', 'og:image:type', 'image/png')
    upsertMeta('property', 'og:image:width', '1200')
    upsertMeta('property', 'og:image:height', '630')
    upsertMeta('property', 'og:image:alt', t.meta.ogTitle)
    upsertMeta('property', 'og:locale', OG_LOCALE[lang])
    document.head.querySelectorAll('meta[property="og:locale:alternate"]').forEach((el) => el.remove())
    // One per distinct locale: the two Uzbek alphabets share theirs.
    new Set(LANGUAGES.map((l) => OG_LOCALE[l])).forEach((locale) => {
      if (locale === OG_LOCALE[lang]) return
      const el = document.createElement('meta')
      el.setAttribute('property', 'og:locale:alternate')
      el.content = locale
      document.head.appendChild(el)
    })

    upsertMeta('name', 'twitter:card', 'summary_large_image')
    upsertMeta('name', 'twitter:title', t.meta.ogTitle)
    upsertMeta('name', 'twitter:description', t.meta.ogDescription)
    upsertMeta('name', 'twitter:image', ogImage)
    upsertMeta('name', 'twitter:image:alt', t.meta.ogTitle)

    upsertJsonLd('ld-person', {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: site.name,
      givenName: site.firstName,
      familyName: site.lastName,
      alternateName: site.handle,
      jobTitle: t.meta.jobTitle,
      description: t.meta.ogDescription,
      url: canonical,
      image: ogImage,
      email: `mailto:${site.email}`,
      sameAs: [site.social.github, site.social.instagram, site.social.telegram],
      knowsAbout: technologies.map((tech) => tech.name),
      alumniOf: { '@type': 'CollegeOrUniversity', name: 'Toshkent Gumanitar Fanlar Universiteti' },
      homeLocation: { '@type': 'Place', name: 'Kokand, Uzbekistan' },
    })
    upsertJsonLd('ld-website', {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.name,
      url: canonical,
      inLanguage: ALTERNATES.map((alternate) => alternate.hreflang),
    })
  }, [t, lang])

  return null
}
