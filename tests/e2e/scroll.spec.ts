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

/** Where something in the sky is: its centre as a fraction of the screen, and how much of it is drawn. */
const inTheSky = (page: Page, what: 'sun' | 'moon') =>
  page.locator(`.scroll-sky__${what}`).evaluate((el) => {
    const box = el.getBoundingClientRect()
    return {
      x: (box.left + box.width / 2) / window.innerWidth,
      y: (box.top + box.height / 2) / window.innerHeight,
      opacity: Number(getComputedStyle(el).opacity),
    }
  })

/** The sun through the day and the moon at night, read off the real page. */
async function followTheDay(page: Page): Promise<void> {
  // Morning: the sun is on the horizon, low on the left, and there is no moon yet.
  await expect.poll(async () => (await inTheSky(page, 'sun')).opacity).toBeGreaterThan(0.95)
  const dawn = await inTheSky(page, 'sun')
  expect(dawn.y).toBeGreaterThan(0.92)
  expect(dawn.x).toBeGreaterThan(0.1)
  expect(dawn.x).toBeLessThan(0.3)
  expect((await inTheSky(page, 'moon')).opacity).toBeLessThan(0.05)

  // The middle of the day: along the top of the screen, above anything being read.
  // The page keeps its hours by section, not by how far down it a section is —
  // the long walk alone is a third of its length — so noon is found by one too.
  await jump(page, await page.evaluate(() => document.getElementById('skills')!.getBoundingClientRect().top + window.scrollY))
  await expect.poll(async () => (await inTheSky(page, 'sun')).y).toBeLessThan(0.2)
  const noon = await inTheSky(page, 'sun')
  expect(noon.y).toBeGreaterThan(0.05)
  expect(noon.x).toBeGreaterThan(0.3)
  expect(noon.x).toBeLessThan(0.6)
  expect(noon.opacity).toBeGreaterThan(0.95)

  // Night: the sun has gone and the moon is in the top right corner.
  await expect
    .poll(async () => {
      await jump(page, await bottom(page))
      return (await inTheSky(page, 'moon')).opacity
    })
    .toBeGreaterThan(0.95)
  const night = await inTheSky(page, 'moon')
  expect(night.x).toBeGreaterThan(0.8)
  expect(night.x).toBeLessThan(0.95)
  expect(night.y).toBeGreaterThan(0.05)
  expect(night.y).toBeLessThan(0.2)
  expect((await inTheSky(page, 'sun')).opacity).toBeLessThan(0.05)
}

test('the sun comes up with the page, crosses the top of the screen and leaves the night to the moon', async ({ page }) => {
  const problems = await open(page, '/?lang=en&theme=dark')
  await followTheDay(page)
  expect(problems).toEqual([])
})

test('the day keeps to the sections, not to the length of the page: the sun sets behind the projects and the moon rises over the code', async ({ page }) => {
  const problems = await open(page, '/?lang=en&theme=dark')
  // Let the page reach its full length first: the GitHub section has no numbers until it is nearly on screen.
  await scrollTo(page, 'github')
  await expect(page.locator('#github [data-stat]')).toHaveCount(5)
  /** Where the page has to be for an edge of a section to sit on the same edge of the screen. */
  const edge = (id: string, which: 'top' | 'bottom') =>
    page.evaluate(
      ([section, side]) => {
        const box = document.getElementById(section!)!.getBoundingClientRect()
        return side === 'top' ? box.top + window.scrollY : box.bottom + window.scrollY - window.innerHeight
      },
      [id, which],
    )

  // The projects arrive under a high sun…
  await jump(page, await edge('projects', 'top'))
  await expect.poll(async () => (await inTheSky(page, 'sun')).opacity).toBeGreaterThan(0.95)
  expect((await inTheSky(page, 'sun')).y).toBeLessThan(0.25)
  // …and it is down by the time they let go of the screen, with no moon yet. A step past the edge itself:
  // the sun fades out in the last few pixels before it, and the clock is only re-measured for a move that would show.
  await jump(page, (await edge('projects', 'bottom')) + 24)
  await expect.poll(async () => (await inTheSky(page, 'sun')).opacity).toBeLessThan(0.05)
  expect((await inTheSky(page, 'moon')).opacity).toBeLessThan(0.05)
  // Over the GitHub section there is only the moon, on its way up the right-hand edge.
  await jump(page, await edge('github', 'top'))
  await expect.poll(async () => (await inTheSky(page, 'moon')).opacity).toBeGreaterThan(0.95)
  const rising = await inTheSky(page, 'moon')
  expect(rising.x).toBeGreaterThan(0.88)
  expect(rising.y).toBeGreaterThan(0.3)
  expect(rising.y).toBeLessThan(0.95)
  expect((await inTheSky(page, 'sun')).opacity).toBeLessThan(0.05)
  // By the contact section it is night and the moon is nearly where it stays.
  await jump(page, await edge('contact', 'top'))
  await expect.poll(async () => (await inTheSky(page, 'moon')).y).toBeLessThan(0.2)
  expect(await page.locator('.scroll-sky__night').evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.9)
  expect(problems).toEqual([])
})

test('the light theme has the same sun and a pale moon in its dusk', async ({ page }) => {
  const problems = await open(page, '/?lang=en&theme=light')
  await followTheDay(page)
  expect(await page.locator('.scroll-sky__disc--moon').evaluate((el) => getComputedStyle(el).display)).not.toBe('none')
  expect(problems).toEqual([])
})

test('a browser with no scroll timelines gets the same day from the scroll listener', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { ScrollTimeline?: unknown }).ScrollTimeline
  })
  const problems = await open(page, '/?lang=en&theme=dark')
  expect(await page.evaluate(() => 'ScrollTimeline' in window)).toBe(false)
  await followTheDay(page)
  // The four lights go the same way: night at the bottom, no morning left.
  const opacity = (layer: string) => page.locator(`.scroll-sky__${layer}`).evaluate((el) => Number(getComputedStyle(el).opacity))
  expect(await opacity('night')).toBeGreaterThan(0.95)
  expect(await opacity('dawn')).toBeLessThan(0.05)
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

  test('the sun and the moon come and go where they hang, and do not travel', async ({ page }) => {
    const problems = await open(page, '/?lang=en&theme=dark')
    // No sun in the morning: it only shows where it would be highest.
    expect((await inTheSky(page, 'sun')).opacity).toBeLessThan(0.05)
    const before = await inTheSky(page, 'sun')

    await jump(page, (await bottom(page)) * 0.4)
    await expect.poll(async () => (await inTheSky(page, 'sun')).opacity).toBeGreaterThan(0.95)
    const noon = await inTheSky(page, 'sun')
    expect(noon.x).toBeCloseTo(before.x, 3)
    expect(noon.y).toBeCloseTo(before.y, 3)
    expect(noon.y).toBeLessThan(0.2)

    const moonBefore = await inTheSky(page, 'moon')
    expect(moonBefore.opacity).toBeLessThan(0.05)
    await expect
      .poll(async () => {
        await jump(page, await bottom(page))
        return (await inTheSky(page, 'moon')).opacity
      })
      .toBeGreaterThan(0.95)
    const night = await inTheSky(page, 'moon')
    expect(night.x).toBeCloseTo(moonBefore.x, 3)
    expect(night.y).toBeCloseTo(moonBefore.y, 3)
    expect((await inTheSky(page, 'sun')).opacity).toBeLessThan(0.05)
    expect(problems).toEqual([])
  })
})
