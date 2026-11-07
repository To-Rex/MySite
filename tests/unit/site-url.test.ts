import { afterEach, describe, expect, it, vi } from 'vitest'
import { CANONICAL_URL, resolveSiteUrl } from '../../scripts/site-url.mjs'

/**
 * One function decides the address in the canonical tag, og:url, the static
 * head, robots.txt and sitemap.xml. If it picks wrong, every one of them
 * advertises a site that is somewhere else.
 */
describe('resolveSiteUrl', () => {
  afterEach(() => vi.restoreAllMocks())

  it('falls back to the production domain for a local build', () => {
    expect(resolveSiteUrl({})).toBe(CANONICAL_URL)
  })

  it('prefers an explicit VITE_SITE_URL over anything the host sets', () => {
    expect(
      resolveSiteUrl({ VITE_SITE_URL: 'https://explicit.example', URL: 'https://netlify.example', DEPLOY_PRIME_URL: 'https://preview.example' }),
    ).toBe('https://explicit.example')
  })

  it("uses Netlify's primary URL before a preview URL", () => {
    expect(resolveSiteUrl({ URL: 'https://site.netlify.app', DEPLOY_PRIME_URL: 'https://preview.example' })).toBe('https://site.netlify.app')
    expect(resolveSiteUrl({ DEPLOY_PRIME_URL: 'https://preview.example' })).toBe('https://preview.example')
  })

  it('strips trailing slashes and surrounding whitespace, so "/og.png" can be appended', () => {
    expect(resolveSiteUrl({ VITE_SITE_URL: '  https://torexdev.uz///  ' })).toBe('https://torexdev.uz')
  })

  it('refuses a value that is not a URL rather than baking it into every tag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveSiteUrl({ VITE_SITE_URL: 'torexdev dot uz' })).toBe(CANONICAL_URL)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('treats an empty variable as unset', () => {
    expect(resolveSiteUrl({ VITE_SITE_URL: '', URL: 'https://site.netlify.app' })).toBe('https://site.netlify.app')
  })
})
