import { expect, test, type Page } from '@playwright/test'
import { open } from './site'

/**
 * The extinction cinematic, started the way a visitor starts it: by clicking
 * the name in the header. What is checked here is the part a screenshot cannot
 * show — that the sound is opened inside that click, offered a way off, and
 * kept off for someone who has turned it off — and that all of it runs under
 * the production policy.
 */

const NAME = 'header a[aria-label="Dilshodjon Haydarov"]'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const made: AudioContext[] = []
    ;(window as unknown as { contexts: AudioContext[] }).contexts = made
    const Real = window.AudioContext
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options)
        made.push(this)
      }
    }
  })
})

const contexts = (page: Page) => page.evaluate(() => (window as unknown as { contexts: AudioContext[] }).contexts.length)

test('clicking the name starts the valley with sound, and the sound can be turned off', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the same code on a phone; once is enough for a twenty-second showing')
  test.slow()
  const problems = await open(page, '/?lang=en')
  expect(await contexts(page)).toBe(0)

  // Built ahead of time, nine seconds in; a click before that builds it on the spot.
  await page.locator('[data-valley]').waitFor({ state: 'attached', timeout: 60_000 })
  await page.locator(NAME).click()
  // Inside the click, or a browser will not let it start.
  expect(await contexts(page)).toBe(1)

  const toggle = page.locator('[data-sound]')
  await expect(toggle).toBeVisible({ timeout: 60_000 })
  await expect(toggle).toHaveAttribute('data-sound', 'on')
  await expect(toggle).toHaveAccessibleName('Turn sound off')
  await expect(page.locator('[data-valley] canvas')).toHaveAttribute('data-quality', /\w/)

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-sound', 'off')
  expect(await page.evaluate(() => localStorage.getItem('dh.sound'))).toBe('off')
  expect(problems).toEqual([])
  // Not sat through to the end: on a software renderer the showing takes the
  // cores the rest of the suite is running on. `npm run shots` plays it through.
  await page.close()
})

test('a visitor who turned sound off gets the valley without it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dh.sound', 'off'))
  await open(page, '/?lang=en')
  await page.locator(NAME).click()
  await page.waitForTimeout(300)
  expect(await contexts(page)).toBe(0)
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('has no valley, and so opens no sound for one', async ({ page }) => {
    await open(page, '/?lang=en')
    await page.locator(NAME).click()
    await page.waitForTimeout(300)
    expect(await contexts(page)).toBe(0)
    await expect(page.locator('[data-valley]')).toHaveCount(0)
  })
})
