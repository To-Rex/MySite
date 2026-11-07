import { expect, test } from '@playwright/test'
import { SECTIONS, introDone, mockGithub, open, scrollTo, watch } from './site'

/**
 * The built site, in a real browser, behind the real response headers.
 * Run `npm run build` first; `npm run test:e2e` serves `dist/` itself.
 */

test('runs clean from top to bottom under the production Content-Security-Policy', async ({ page, request }) => {
  // The heaviest test here: the full intro, then every 3D chunk and canvas on
  // the page. On a CI runner, where WebGL is software-rendered, the desktop
  // viewport alone needs more than the usual minute.
  test.slow()

  // The point of serving dist/ ourselves: make sure the policy really is on.
  const document = await request.get('/')
  const policy = document.headers()['content-security-policy'] ?? ''
  expect(policy).toContain("default-src 'self'")
  expect(policy).toMatch(/script-src 'self' 'sha256-/)

  const problems = await open(page, '/?lang=en', { firstVisit: true })
  await expect(page.locator('#hero-title')).toBeVisible()

  // Walk the page so every lazy thing is asked for: the 3D chunks, the worker,
  // the fonts, the GitHub requests. Anything the policy refuses lands in
  // `problems` as a console error.
  for (const id of SECTIONS) {
    await scrollTo(page, id)
    await page.waitForTimeout(400)
  }
  await expect(page.getByText('fixture-flutter-app')).toBeVisible()
  // Long enough for the companion's chunk and canvas, which load on a timer.
  await page.waitForTimeout(2500)

  expect(problems).toEqual([])
})

test('has every section, a single h1 and a skip link', async ({ page }) => {
  await open(page, '/?lang=en')
  for (const id of SECTIONS) await expect(page.locator(`section#${id}`)).toHaveCount(1)
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.locator('h1')).toHaveText(/Dilshodjon\s*Haydarov/i)
  await expect(page.locator('a[href="#main"]')).toHaveText('Skip to main content')
  await expect(page.locator('main#main')).toHaveCount(1)
})

test('links to the real social profiles, safely', async ({ page }) => {
  await open(page, '/?lang=en')
  // The Telegram link that could not exist: "@" in the path, a dot in the name.
  expect(await page.locator('a[href*="t.me/@"], a[href*="torex.dev" i][href*="t.me"]').count()).toBe(0)
  expect(await page.locator('a[href="https://t.me/torex_dev"]').count()).toBeGreaterThanOrEqual(2)
  // The contact row is one stretched link; the handle it names is in its label.
  await expect(page.locator('#contact a[href="https://t.me/torex_dev"]')).toHaveAccessibleName(/@torex_dev/)
  expect(await page.locator('a[href="https://www.instagram.com/torex.dev/"]').count()).toBeGreaterThanOrEqual(2)
  expect(await page.locator('a[href="https://github.com/To-Rex"]').count()).toBeGreaterThanOrEqual(2)

  // A new tab must not get a handle on this window.
  const unsafe = await page.locator('a[target="_blank"]').evaluateAll((links) =>
    links.filter((link) => !/\bnoopener\b/.test(link.getAttribute('rel') ?? '')).map((link) => link.getAttribute('href')),
  )
  expect(unsafe).toEqual([])
})

test.describe('language', () => {
  test('?lang= decides the language of a shared link', async ({ page }) => {
    await open(page, '/?lang=de')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page).toHaveTitle(/Entwickler/)
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'de_DE')
  })

  test.describe('with a Russian browser', () => {
    test.use({ locale: 'ru-RU' })

    test('the browser language is used on a first visit, and a choice outlives it', async ({ page, isMobile }) => {
      await open(page, '/')
      await expect(page.locator('html')).toHaveAttribute('lang', 'ru')

      // On a phone the switcher lives in the menu.
      if (isMobile) await page.locator('header button[aria-controls="mobile-menu"]').click()
      const scope = isMobile ? page.locator('#mobile-menu') : page.locator('header')
      await scope.locator('button[lang="uz"]').click()
      await expect(page.locator('html')).toHaveAttribute('lang', 'uz-Latn-UZ')
      await expect(page).toHaveTitle(/Dasturchi/)

      await page.reload()
      await introDone(page)
      await expect(page.locator('html')).toHaveAttribute('lang', 'uz-Latn-UZ')
    })
  })
})

test.describe('theme', () => {
  test.use({ colorScheme: 'dark' })

  test('follows the system, then remembers a choice, and ?theme= overrides both', async ({ page, isMobile }) => {
    await open(page, '/?lang=en')
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'dark')

    if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('button', { name: 'Switch to light mode' }).first().click()
    await expect(html).toHaveAttribute('data-theme', 'light')

    await page.reload()
    await introDone(page)
    // Set before first paint by the inline script — the one the CSP hash pins.
    await expect(html).toHaveAttribute('data-theme', 'light')

    await page.goto('/?lang=en&theme=dark')
    await expect(html).toHaveAttribute('data-theme', 'dark')
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('skips the intro and still shows the whole page', async ({ page }) => {
    const problems = watch(page)
    await mockGithub(page)
    await page.goto('/?lang=en')
    // No curtain to wait for: the name is simply there.
    await expect(page.locator('#hero-title')).toBeVisible()
    await expect(page.locator('[class~="z-[1000]"]')).toHaveCount(0)
    await page.locator('#contact').scrollIntoViewIfNeeded()
    await expect(page.locator('#contact-title')).toBeVisible()
    expect(problems).toEqual([])
  })
})
