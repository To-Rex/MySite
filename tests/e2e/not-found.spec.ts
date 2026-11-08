import { expect, test } from '@playwright/test'
import { mockGithub, watch } from './site'

/**
 * An address with nothing at it, in a real browser, served the way Netlify
 * serves it: `dist/404.html`, a 404 status and the production policy.
 */

const ROAR = 'Make it roar'

test('an address with nothing at it gets this page, with a real 404 and the policy on', async ({ page }) => {
  const response = await page.goto('/admin?lang=en')
  expect(response?.status()).toBe(404)
  expect(response?.headers()['content-security-policy']).toMatch(/script-src 'self' 'sha256-/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName('This page went extinct.')
  await expect(page.locator('main code')).toHaveText('/admin')
  await expect(page).toHaveTitle(/went extinct/)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
})

test('runs clean under the production policy, however deep the address, 3D and all', async ({ page }) => {
  // Everything the page has: the chunks, the worker, the shaders, a meteor and a roar.
  test.slow()
  const problems = watch(page, { missingDocument: true })
  await page.goto('/a/very/deep/address/indeed?lang=en')
  await expect(page.locator('canvas')).toHaveCount(1, { timeout: 30_000 })

  const roar = page.getByRole('button', { name: ROAR })
  await expect(roar).toBeVisible({ timeout: 90_000 })

  // With the sound on, so the voice worker and the whole mix run under the policy too.
  await page.locator('[data-sound]').click()
  await expect(page.locator('[data-sound]')).toHaveAttribute('data-sound', 'on')
  await page.waitForTimeout(1500)

  await page.mouse.click(page.viewportSize()!.width * 0.5, page.viewportSize()!.height * 0.25)
  await roar.click()
  await page.waitForTimeout(2500)

  expect(problems).toEqual([])
})

test('the way home goes home', async ({ page }) => {
  await mockGithub(page)
  await page.goto('/nope?lang=en')
  await page.getByRole('link', { name: /Back to the home page/ }).click()
  await expect(page).toHaveURL(/\/\?lang=en$/)
  await expect(page.locator('section#home')).toHaveCount(1)
})

test('shows a hostile address as text', async ({ page }) => {
  let alerted = false
  page.on('dialog', (dialog) => {
    alerted = true
    void dialog.dismiss()
  })
  await page.goto('/%3Cimg%20src=x%20onerror=alert(1)%3E?lang=en')
  await expect(page.locator('main code')).toHaveText('/<img src=x onerror=alert(1)>')
  await expect(page.locator('main img')).toHaveCount(0)
  expect(alerted).toBe(false)
})

test('its language and theme controls work', async ({ page }) => {
  const problems = watch(page, { missingDocument: true })
  await page.goto('/nope?lang=en&theme=dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.locator('header button[lang="de"]').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName('Diese Seite ist ausgestorben.')
  await expect(page).toHaveTitle(/ausgestorben/)

  await page.locator('header button[aria-label]').last().click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(problems).toEqual([])
})

test.describe('sound', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const contexts: AudioContext[] = []
      ;(window as unknown as { contexts: AudioContext[] }).contexts = contexts
      const Real = window.AudioContext
      window.AudioContext = class extends Real {
        constructor(options?: AudioContextOptions) {
          super(options)
          contexts.push(this)
        }
      }
    })
  })

  const opened = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { contexts: AudioContext[] }).contexts.length)
  const toggle = (page: import('@playwright/test').Page) => page.locator('[data-sound]')

  test('waits to be asked, opens on the button, and stays off once turned off', async ({ page }) => {
    await page.goto('/nope?lang=en')
    await expect(toggle(page)).toHaveAttribute('data-sound', 'locked')
    await expect(toggle(page)).toHaveAccessibleName('Turn sound on')
    expect(await opened(page)).toBe(0)

    await toggle(page).click()
    await expect(toggle(page)).toHaveAttribute('data-sound', 'on')
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle(page)).toHaveAccessibleName('Turn sound off')
    expect(await opened(page)).toBe(1)

    await toggle(page).click()
    await expect(toggle(page)).toHaveAttribute('data-sound', 'off')
    expect(await page.evaluate(() => localStorage.getItem('dh.sound'))).toBe('off')

    await page.reload()
    await expect(toggle(page)).toHaveAttribute('data-sound', 'off')
    await page.mouse.click(40, 300)
    await page.waitForTimeout(150)
    await expect(toggle(page)).toHaveAttribute('data-sound', 'off')
    expect(await opened(page)).toBe(0)
  })

  test('is opened by the first click anywhere on the page', async ({ page }) => {
    await page.goto('/nope?lang=en')
    await expect(toggle(page)).toHaveAttribute('data-sound', 'locked')
    await page.mouse.click(40, 300)
    await expect(toggle(page)).toHaveAttribute('data-sound', 'on')
    expect(await opened(page)).toBe(1)
  })
})

test.describe('with a browser the site has no language for', () => {
  test.use({ locale: 'fr-FR' })

  test('speaks Uzbek in the new alphabet', async ({ page }) => {
    await page.goto('/nope')
    await expect(page.locator('html')).toHaveAttribute('lang', 'uz-Latn-UZ-x-yangi')
    await expect(page).toHaveTitle(/yöq bölib/)
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('shows the finished tableau, with nothing to set off', async ({ page }) => {
    const problems = watch(page, { missingDocument: true })
    await page.goto('/nope?lang=en')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(1, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    await expect(page.getByRole('button', { name: ROAR })).toHaveCount(0)
    await expect(page.locator('[data-sound]')).toHaveCount(0)
    expect(problems).toEqual([])
  })
})

test('stands up by itself if the 3D cannot be fetched', async ({ page }) => {
  await page.route('**/assets/NotFoundScene-*.js', (route) => route.abort())
  await page.goto('/nope?lang=en')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName('This page went extinct.')
  await expect(page.locator('.not-found-number')).toHaveCSS('opacity', '0.9')
  await expect(page.getByRole('link', { name: /Back to the home page/ })).toBeVisible()
})

test.describe('without WebGL', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) => unknown
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        return /webgl/.test(kind) ? null : real.call(this, kind, ...rest)
      } as never
    })
  })

  test('still says everything, and the number is still there', async ({ page }) => {
    const problems = watch(page, { missingDocument: true })
    await page.goto('/nope?lang=en')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('.not-found-number')).toHaveCSS('opacity', '0.9')
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect(page.getByRole('button', { name: ROAR })).toHaveCount(0)
    await expect(page.locator('[data-sound]')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Back to the home page/ })).toBeVisible()
    expect(problems).toEqual([])
  })
})
