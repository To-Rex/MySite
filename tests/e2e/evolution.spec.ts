import { expect, test, type Page } from '@playwright/test'
import { open } from './site'

/**
 * The long walk: the pinned scene straight after the hero that the scroll runs
 * from a cave to a screen. What is checked here is what the page does round it
 * — that the stage pins, the words follow the scroll, the scene is built and
 * follows it too, and the page carries on afterwards — not what the picture
 * looks like, which is `npm run shots`.
 */

/** Scrolls the walk to a point of itself, 0 to 1. */
async function walkTo(page: Page, progress: number): Promise<void> {
  await page.evaluate((p) => {
    const el = document.getElementById('evolution')!
    const stage = el.firstElementChild as HTMLElement
    const top = el.getBoundingClientRect().top + window.scrollY
    window.scrollTo(0, Math.round(top + p * (el.offsetHeight - stage.clientHeight)))
  }, progress)
  await page.waitForTimeout(160)
}

const shown = (page: Page) =>
  page.locator('.evolution-caption').evaluateAll((items) => items.filter((item) => Number(getComputedStyle(item).opacity) > 0.5).map((item) => (item as HTMLElement).dataset.era))

test('the walk comes straight after the hero and pins for its whole length', async ({ page }) => {
  const problems = await open(page, '/?lang=en')
  const walk = page.locator('#evolution')
  await expect(walk).toHaveAttribute('aria-label', /long walk/i)
  // It is the hero's next sibling, and many windows tall.
  expect(await page.evaluate(() => document.getElementById('home')?.nextElementSibling?.id)).toBe('evolution')
  const shape = await walk.evaluate((el) => ({ tall: (el as HTMLElement).offsetHeight / window.innerHeight, stage: (el.firstElementChild as HTMLElement).offsetHeight / window.innerHeight }))
  expect(shape.tall).toBeGreaterThan(6)
  expect(shape.stage).toBeGreaterThan(0.85)
  expect(shape.stage).toBeLessThan(1.15)

  // Pinned: at any point of it the stage is at the top of the window.
  for (const at of [0.1, 0.5, 0.9]) {
    await walkTo(page, at)
    const top = await page.locator('.evolution-stage').evaluate((el) => el.getBoundingClientRect().top)
    expect(Math.abs(top)).toBeLessThan(2)
  }
  // And then it lets go, and the page goes on.
  await page.evaluate(() => document.getElementById('about')?.scrollIntoView({ block: 'start' }))
  await expect(page.locator('#about')).toBeInViewport()
  expect(await page.locator('.evolution-stage').evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThan(10)
  expect(problems).toEqual([])
})

test('the words follow the scroll: one line for each era, never two', async ({ page }) => {
  const problems = await open(page, '/?lang=en')
  const walk = page.locator('#evolution')
  const expected = [
    [0.08, 'fire', 'It began with a fire'],
    [0.32, 'hunt', 'Then they went out'],
    [0.55, 'field', 'They stayed'],
    [0.76, 'city', 'The fires multiplied'],
    [0.94, 'now', 'One of those lights is a screen'],
  ] as const
  for (const [at, era, line] of expected) {
    await walkTo(page, at)
    await expect(walk).toHaveAttribute('data-era', era)
    await expect.poll(() => shown(page)).toEqual([era])
    await expect(page.locator(`.evolution-caption[data-era="${era}"] .evolution-line`)).toContainText(line)
  }
  // Between two eras there is a moment with no words at all.
  await walkTo(page, 0.2)
  await expect.poll(() => shown(page)).toEqual([])
  // All five are in the page for someone who is not looking at it.
  await expect(page.locator('.evolution-caption')).toHaveCount(5)
  await expect(page.getByRole('heading', { name: 'The long walk' })).toBeAttached()
  expect(problems).toEqual([])
})

test('the scene is built, follows the scroll, and takes no clicks', async ({ page }) => {
  // On a CI runner WebGL is drawn by the CPU: the scene waits six seconds for a
  // reader who has plainly stopped before it is built at all, and a frame of it
  // then takes seconds. What is asked there is only that it arrives and breaks
  // nothing; that it follows the scroll is checked where there is a card.
  test.slow()
  const problems = await open(page, '/?lang=en')
  await walkTo(page, 0.05)
  const canvas = page.locator('#evolution canvas')
  await canvas.waitFor({ state: 'attached', timeout: 120_000 })
  // Full-bleed and pinned: the canvas and R3F's own wrapper both let the pointer through.
  expect(await canvas.evaluate((el) => getComputedStyle(el.parentElement!.parentElement!).pointerEvents)).toBe('none')

  if (!process.env.CI) {
    await expect(canvas).toHaveAttribute('data-walk', /^\d\.\d{3}$/, { timeout: 90_000 })
    for (const at of [0.3, 0.72, 0.4]) {
      await walkTo(page, at)
      await expect.poll(async () => Math.abs(Number(await canvas.getAttribute('data-walk')) - at), { timeout: 15_000 }).toBeLessThan(0.01)
    }
  }
  expect(problems).toEqual([])
})

test('the companion steps aside while the walk is on screen', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the same gate on a phone')
  const problems = await open(page, '/?lang=en')
  await walkTo(page, 0.4)
  // Whatever the turtle is, it is not drawn over the stage: nothing fixed sits on top of its middle but the stage's own things.
  const top = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    return !!el?.closest('#evolution')
  })
  expect(top).toBe(true)
  expect(problems).toEqual([])
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('there is no walk: the page goes from the hero to About', async ({ page }) => {
    const problems = await open(page, '/?lang=en')
    await expect(page.locator('#evolution')).toHaveCount(0)
    expect(await page.evaluate(() => document.getElementById('home')?.nextElementSibling?.id)).toBe('about')
    expect(problems).toEqual([])
  })
})
