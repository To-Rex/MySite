// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dictionaries } from '@/i18n/context'
import { I18nProvider } from '@/i18n/I18nProvider'
import { NotFound } from '@/sections/NotFound'
import { ThemeProvider } from '@/theme/ThemeProvider'

/**
 * The words of the 404 page, in a DOM with no WebGL: what every visitor gets
 * before the 3D has arrived, and all some ever get.
 */

function visit(url: string, browser: string[] = ['en-US']) {
  window.history.replaceState(null, '', url)
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(browser)
  return render(
    <ThemeProvider>
      <I18nProvider>
        <NotFound />
      </I18nProvider>
    </ThemeProvider>,
  )
}

class Unobserved {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IntersectionObserver', Unobserved)
  vi.stubGlobal('ResizeObserver', Unobserved)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null) as never
  document.head.innerHTML = '<meta name="description" content="" />'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const chip = (view: ReturnType<typeof render>) => view.container.querySelector('code')

describe('the 404 page', () => {
  it('says what happened, in the language of the visit', () => {
    visit('/admin?lang=de')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('ausgestorben')
    expect(screen.getByText(dictionaries.de.notFound.text)).toBeTruthy()
  })

  it('names the address that was asked for', () => {
    const view = visit('/admin/settings?lang=en&utm=x')
    expect(chip(view)?.textContent).toBe('/admin/settings')
  })

  it('shows a hostile address as text and nothing else', () => {
    const view = visit('/%3Cimg%20src=x%20onerror=alert(1)%3E?lang=en')
    expect(chip(view)?.textContent).toBe('/<img src=x onerror=alert(1)>')
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('survives an address that cannot be decoded', () => {
    const view = visit('/%E0%A4%A?lang=en')
    expect(chip(view)?.textContent).toBe('/%E0%A4%A')
  })

  it.each(['/404', '/404.html'])('does not name itself at %s', (path) => {
    const view = visit(`${path}?lang=en`)
    expect(chip(view)).toBeNull()
  })

  it('always offers the way home', () => {
    visit('/nope?lang=en')
    expect(screen.getByRole('link', { name: new RegExp(dictionaries.en.notFound.home) }).getAttribute('href')).toBe('/?lang=en')
  })

  it('takes a link shared in a language back home in that language, and no other', () => {
    visit('/nope')
    expect(screen.getByRole('link', { name: new RegExp(dictionaries.en.notFound.home) }).getAttribute('href')).toBe('/')
    cleanup()
    visit('/nope?lang=klingon')
    expect(screen.getByRole('link', { name: new RegExp(dictionaries.en.notFound.home) }).getAttribute('href')).toBe('/')
  })

  it('puts its title and description in the head', () => {
    visit('/nope?lang=ru')
    expect(document.title).toBe(dictionaries.ru.notFound.metaTitle)
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(dictionaries.ru.notFound.metaDescription)
  })

  it('is in the new alphabet when nothing says otherwise', () => {
    visit('/nope', ['fr-FR'])
    expect(document.documentElement.lang).toBe('uz-Latn-UZ-x-yangi')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('yöq')
  })

  it('does not offer to roar when there is nothing to do the roaring', () => {
    visit('/nope?lang=en')
    expect(screen.queryByRole('button', { name: dictionaries.en.notFound.roar })).toBeNull()
    expect(screen.queryByText(dictionaries.en.notFound.hint)).toBeNull()
  })

  it('does not offer sound when there is nothing to hear', () => {
    const view = visit('/nope?lang=en')
    expect(view.container.querySelector('[data-sound]')).toBeNull()
  })
})
