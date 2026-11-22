import { expect, test, type Page } from '@playwright/test'
import { open, scrollTo } from './site'

/**
 * What the page does as it is scrolled: the trail along the top edge, the sky
 * behind everything, the projects row and the marquee. Each of these is wired
 * to the scroll position rather than to time, so each is checked by moving the
 * page and reading back where things ended up.
 */

/** Scrolls the page straight to `y` and gives Lenis and the listeners a frame or two to catch up. */
async function jump(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => window.scrollTo(0, top), Math.round(y))
  await page.waitForTimeout(120)
}

const bottom = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)

/** Scrolls by `step` pixels a frame for `frames` frames, the way a wheel or a thumb would. */
async function drag(page: Page, step: number, frames: number): Promise<void> {
  await page.evaluate(
    ([by, count]) =>
      new Promise<void>((done) => {
        let left = count
        const tick = () => {
          window.scrollBy(0, by)
          if (--left > 0) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      }),
    [step, frames] as const,
  )
}

test('the trail puts a print down for every stretch read, and lifts them on the way back', async ({ page }) => {
  const problems = await open(page, '/?lang=en')
  const trail = page.locator('.reading-trail')
  await expect(trail).toHaveAttribute('data-down', '0')
  const prints = Number(await trail.getAttribute('data-prints'))
  expect(prints).toBeGreaterThanOrEqual(12)

  await jump(page, (await bottom(page)) / 2)
  await expect.poll(async () => Number(await trail.getAttribute('data-down'))).toBeGreaterThan(prints * 0.35)
  await expect.poll(async () => Number(await trail.getAttribute('data-down'))).toBeLessThan(prints * 0.65)

  // The page keeps growing as the GitHub section answers, so chase the bottom.
  await expect
    .poll(async () => {
      await jump(page, await bottom(page))
      return Number(await trail.getAttribute('data-down'))
    })
    .toBe(prints)
  // The newest print is the one most visible; the first is on the page too.
  await expect.poll(() => trail.locator('.reading-trail__print').last().evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.9)
  expect(await trail.locator('.reading-trail__print').first().evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.3)

  await jump(page, 0)
  await expect(trail).toHaveAttribute('data-down', '0')
  expect(problems).toEqual([])
})

test('the sky is morning at the top of the page and night at the bottom', async ({ page }) => {
  const problems = await open(page, '/?lang=en&theme=dark')
  const opacity = (layer: string) => page.locator(`.scroll-sky__${layer}`).evaluate((el) => Number(getComputedStyle(el).opacity))

  await expect.poll(() => opacity('dawn')).toBeGreaterThan(0.95)
  expect(await opacity('night')).toBeLessThan(0.05)

  await expect
    .poll(async () => {
      await jump(page, await bottom(page))
      return opacity('night')
    })
    .toBeGreaterThan(0.95)
  expect(await opacity('dawn')).toBeLessThan(0.05)
  // Stars only come out in the dark theme, and there are some to come out.
  expect(await page.locator('.scroll-sky__stars circle').count()).toBeGreaterThan(40)
  expect(problems).toEqual([])
})

test.describe('the projects row', () => {
  const gallery = (page: Page) =>
    page.evaluate(() => {
      const wrapper = document.querySelector<HTMLElement>('[data-gallery]')
      const scroller = document.querySelector<HTMLElement>('.gallery-scroller')
      if (!wrapper || !scroller) return null
      const stage = scroller.parentElement?.clientHeight ?? 0
      return {
        top: wrapper.getBoundingClientRect().top + window.scrollY,
        travel: scroller.scrollWidth - scroller.clientWidth,
        lead: Math.round(stage * 0.06),
        left: scroller.scrollLeft,
      }
    })

  test('slides sideways as the page goes down, a pixel for a pixel', async ({ page }) => {
    const problems = await open(page, '/?lang=en')
    await scrollTo(page, 'projects')
    await expect(page.locator('#projects-title')).toBeInViewport()
    const start = await gallery(page)
    expect(start).not.toBeNull()
    expect(start!.travel).toBeGreaterThan(400)
    expect(start!.left).toBe(0)

    await jump(page, start!.top + start!.lead + start!.travel / 2)
    await expect.poll(async () => (await gallery(page))!.left).toBeGreaterThan(start!.travel / 2 - 6)
    expect((await gallery(page))!.left).toBeLessThan(start!.travel / 2 + 6)

    // Held at the end until the section is gone.
    await jump(page, start!.top + start!.lead + start!.travel + 40)
    await expect.poll(async () => (await gallery(page))!.left).toBeGreaterThan(start!.travel - 2)
    await expect(page.locator('.gallery-meter__count').first()).toHaveText('07')
    expect(problems).toEqual([])
  })

  test('moves the page to match when the row itself is moved — by a swipe, or by Tab', async ({ page }) => {
    const problems = await open(page, '/?lang=en')
    await scrollTo(page, 'projects')
    const start = (await gallery(page))!

    // A sideways swipe or trackpad scroll: the page follows the row.
    await page.locator('.gallery-scroller').evaluate((el, x) => {
      el.scrollLeft = x
    }, Math.round(start.travel * 0.6))
    const expected = start.top + start.lead + start.travel * 0.6
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(expected - 8)
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(expected + 8)

    // Back to the start, then focus the last card from the keyboard's side:
    // the browser brings it into the row's view, and the page goes with it.
    await jump(page, start.top)
    await expect.poll(async () => (await gallery(page))!.left).toBeLessThan(2)
    const last = page.getByRole('button', { name: 'Torex Local Storage — Details' })
    await last.focus()
    await expect(last).toBeInViewport()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(start.top + start.lead + start.travel * 0.8)
    expect(problems).toEqual([])
  })
})

test('the marquee runs with the page and turns round when the reader goes back up', async ({ page }) => {
  const problems = await open(page, '/?lang=en')
  const marquee = page.locator('.marquee')
  const top = await marquee.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
  await jump(page, top - 300)
  const offset = () => page.locator('.marquee-track').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)

  // It drifts on its own.
  const before = await offset()
  await page.waitForTimeout(400)
  expect(await offset()).not.toBe(before)

  await drag(page, -14, 20)
  await expect(marquee).toHaveAttribute('data-direction', 'right')
  await drag(page, 14, 20)
  await expect(marquee).toHaveAttribute('data-direction', 'left')
  await drag(page, -14, 20)
  await expect(marquee).toHaveAttribute('data-direction', 'right')

  // …and keeps going that way once the page is still. The row wraps every
  // copy, so the distance is measured round that.
  const period = await page.locator('.marquee-row').first().evaluate((el) => (el as HTMLElement).offsetWidth)
  const at = await offset()
  await page.waitForTimeout(500)
  const moved = (((await offset()) - at) % period + period) % period
  expect(moved).toBeGreaterThan(5)
  expect(moved).toBeLessThan(period / 2)
  expect(problems).toEqual([])
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the projects are a plain grid and the marquee holds still', async ({ page }) => {
    const problems = await open(page, '/?lang=en')
    await expect(page.locator('[data-gallery]')).toHaveCount(0)
    await expect(page.locator('section#projects li')).toHaveCount(7)
    await scrollTo(page, 'about')
    const transform = await page.locator('.marquee-track').evaluate((el) => getComputedStyle(el).transform)
    await page.waitForTimeout(400)
    expect(await page.locator('.marquee-track').evaluate((el) => getComputedStyle(el).transform)).toBe(transform)
    expect(problems).toEqual([])
  })
})
