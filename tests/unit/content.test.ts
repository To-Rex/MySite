import { describe, expect, it } from 'vitest'
import { site } from '@/config/site'
import { NAV_ITEMS, SECTION_IDS } from '@/config/sections'
import { buildingAreas } from '@/content/building'
import { projects } from '@/content/projects'
import { socials } from '@/content/socials'
import { techGroups, technologies } from '@/content/technologies'
import { dictionaries } from '@/i18n/context'
import { LANGUAGES } from '@/i18n/types'

/**
 * The data the page is built from. None of it is code, so the compiler has
 * nothing to say about whether a URL actually points anywhere — and the site
 * shipped for weeks with a Telegram link that could not exist.
 */

const https = (value: string) => {
  const url = new URL(value)
  expect(url.protocol, value).toBe('https:')
  expect(value, 'no stray whitespace').toBe(value.trim())
  return url
}

describe('site identity', () => {
  it('has a canonical origin with no trailing slash', () => {
    const url = https(site.url)
    expect(site.url.endsWith('/')).toBe(false)
    expect(url.pathname).toBe('/')
    expect(url.search + url.hash).toBe('')
  })

  it('has a plausible e-mail address', () => {
    expect(site.email).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i)
  })
})

describe('social links', () => {
  it('lists every platform configured in site.social, once', () => {
    expect(socials.map((s) => s.id).sort()).toEqual(Object.keys(site.social).sort())
  })

  it.each(socials)('$id is an https link', ({ url }) => {
    https(url)
  })

  it('Telegram is a link Telegram can resolve', () => {
    const url = https(site.social.telegram)
    expect(url.hostname).toBe('t.me')
    // t.me takes the bare username: no "@", and a username is 5–32 characters
    // of letters, digits and underscores, starting with a letter. A dot — as in
    // the Instagram handle this was once copied from — is not a legal character.
    expect(url.pathname).toMatch(/^\/[a-z][a-z0-9_]{4,31}\/?$/i)
    expect(site.handles.telegram).toBe(`@${url.pathname.replaceAll('/', '')}`)
  })

  it('Instagram handle and link name the same account', () => {
    const url = https(site.social.instagram)
    expect(url.hostname).toBe('www.instagram.com')
    expect(site.handles.instagram).toBe(`@${url.pathname.split('/').filter(Boolean)[0]}`)
  })

  it('GitHub handle, link and API user name the same account', () => {
    expect(site.social.github).toBe(`https://github.com/${site.github.user}`)
    expect(site.github.url).toBe(site.social.github)
    expect(site.handles.github).toBe(`@${site.github.user}`)
  })
})

describe('projects', () => {
  it('have unique ids', () => {
    const ids = projects.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(LANGUAGES)('have copy for exactly the listed projects in %s', (lang) => {
    expect(Object.keys(dictionaries[lang].projects.items).sort()).toEqual(projects.map((p) => p.id).sort())
  })

  it.each(projects)('$id: optional fields, where present, are real', (project) => {
    if (project.links.github) expect(https(project.links.github).hostname).toBe('github.com')
    if (project.links.demo) https(project.links.demo)
    if (project.year !== undefined) {
      expect(Number.isInteger(project.year)).toBe(true)
      expect(project.year).toBeGreaterThanOrEqual(2015)
      expect(project.year).toBeLessThanOrEqual(new Date().getFullYear())
    }
    // Served from /public or from an https origin the CSP has been taught about.
    if (project.media?.image) expect(project.media.image).toMatch(/^(\/[^/]|https:\/\/)/)
    expect(new Set(project.technologies).size, 'no technology listed twice').toBe(project.technologies.length)
    for (const tech of project.technologies) expect(tech.trim()).toBe(tech)
  })
})

describe('technologies', () => {
  it('have unique ids and names', () => {
    expect(new Set(technologies.map((t) => t.id)).size).toBe(technologies.length)
    expect(new Set(technologies.map((t) => t.name)).size).toBe(technologies.length)
  })

  it.each(technologies)('$id is well-formed', (tech) => {
    https(tech.url)
    expect(techGroups).toContain(tech.group)
    expect(tech.weight).toBeGreaterThan(0)
    expect(tech.weight).toBeLessThanOrEqual(1)
  })

  it('every group has at least one technology in it', () => {
    for (const group of techGroups) expect(technologies.some((t) => t.group === group), group).toBe(true)
  })
})

describe('sections and navigation', () => {
  it('nav items point at sections that exist', () => {
    const ids = Object.values(SECTION_IDS) as string[]
    for (const item of NAV_ITEMS) expect(ids).toContain(item.id)
    expect(new Set(NAV_ITEMS.map((i) => i.id)).size).toBe(NAV_ITEMS.length)
  })

  it('"now building" tiles carry a normalised signal of one length', () => {
    const lengths = new Set(buildingAreas.map((area) => area.signal.length))
    expect(lengths.size).toBe(1)
    for (const area of buildingAreas) {
      for (const value of area.signal) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })
})
