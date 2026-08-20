import { useEffect } from 'react'
import { useI18n } from '@/i18n/context'
import { LANGUAGES, type Language } from '@/i18n/types'
import { site } from '@/config/site'

const OG_LOCALE: Record<Language, string> = { uz: 'uz_UZ', en: 'en_US', de: 'de_DE', ru: 'ru_RU' }
const HREFLANG: Record<Language, string> = { uz: 'uz-Latn', en: 'en', de: 'de', ru: 'ru' }

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
    LANGUAGES.forEach((l) => upsertLink('alternate', `${base}/?lang=${l}`, HREFLANG[l]))
    upsertLink('alternate', canonical, 'x-default')

    upsertMeta('property', 'og:type', 'website')
    upsertMeta('property', 'og:site_name', site.name)
    upsertMeta('property', 'og:title', t.meta.ogTitle)
    upsertMeta('property', 'og:description', t.meta.ogDescription)
    upsertMeta('property', 'og:url', lang === 'uz' ? canonical : `${base}/?lang=${lang}`)
    upsertMeta('property', 'og:image', ogImage)
    upsertMeta('property', 'og:image:width', '1200')
    upsertMeta('property', 'og:image:height', '630')
    upsertMeta('property', 'og:locale', OG_LOCALE[lang])
    document.head.querySelectorAll('meta[property="og:locale:alternate"]').forEach((el) => el.remove())
    LANGUAGES.filter((l) => l !== lang).forEach((l) => {
      const el = document.createElement('meta')
      el.setAttribute('property', 'og:locale:alternate')
      el.content = OG_LOCALE[l]
      document.head.appendChild(el)
    })

    upsertMeta('name', 'twitter:card', 'summary_large_image')
    upsertMeta('name', 'twitter:title', t.meta.ogTitle)
    upsertMeta('name', 'twitter:description', t.meta.ogDescription)
    upsertMeta('name', 'twitter:image', ogImage)

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
      sameAs: [site.social.github, site.social.instagram],
      knowsAbout: ['Flutter', 'Dart', 'Python', 'FastAPI', 'PostgreSQL', 'React', 'TypeScript', 'Git', 'GitHub'],
      alumniOf: { '@type': 'CollegeOrUniversity', name: 'Toshkent Gumanitar Fanlar Universiteti' },
      homeLocation: { '@type': 'Place', name: 'Kokand, Uzbekistan' },
    })
    upsertJsonLd('ld-website', {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.name,
      url: canonical,
      inLanguage: LANGUAGES.map((l) => HREFLANG[l]),
    })
  }, [t, lang])

  return null
}
