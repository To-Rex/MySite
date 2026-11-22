import { expect, test, type Page } from '@playwright/test'
import { github, open, scrollTo } from './site'
import { changes, frames, freeze } from './time'

/**
 * The GitHub section arriving: its numbers count to their values the first
 * time they are seen and its graph draws in as a wave. The numbers are the
 * ones GitHub gave — here, the fixture's — so each count is held to ending on
 * exactly that, and to never showing anything that is not on the way there.
 */

const stars = github.repos.reduce((sum, repo) => sum + repo.stargazers_count, 0)
const joined = new Date(github.profile.created_at).getFullYear()

/** What each of the five numbers says once it has landed, in the order they are shown. */
const LANDED = [String(github.profile.public_repos), String(github.profile.followers), String(stars), String(github.contributions.total.lastYear), String(joined)]

/** What each of the five numbers shows right now: the figure on screen, not the one a screen reader is given. */
const shown = () => [...document.querySelectorAll('#github [data-stat] .count > [aria-hidden]')].map((el) => el.textContent ?? '')

const states = (page: Page) => page.locator('#github [data-stat] .count').evaluateAll((all) => all.map((el) => el.getAttribute('data-count')))

/** Brings the section close enough for its numbers to be fetched, with the row that shows them still below the screen. */
async function fetchTheNumbers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const section = document.getElementById('github')!
    window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - window.innerHeight - 200)
  })
  await expect(page.locator('#github [data-stat]')).toHaveCount(LANDED.length)
}

/**
 * Brings all five numbers on screen. On a phone they are a column, and a
 * number counts when it is seen: the last ones are below the fold when the
 * section's heading is at the top.
 */
async function seeTheNumbers(page: Page): Promise<void> {
  await scrollTo(page, 'github')
  const numbers = page.locator('#github [data-stat]')
  await expect(numbers).toHaveCount(LANDED.length)
  await numbers.last().scrollIntoViewIfNeeded()
}

/**
 * Every frame of the count, from before it starts until `after` frames past
 * the moment the first number moves. That a number is on screen is the
 * browser's to report, and it reports it in its own time, not the page's — on
 * a machine drawing in software that can be most of a second — so frames are
 * dealt out, with a pause for the browser between them, until it has.
 */
async function watchTheCount(page: Page, after: number): Promise<string[][]> {
  const seen = await frames(page, 0, shown)
  for (let waited = 0; waited < 200 && (await states(page)).every((state) => state === 'waiting'); waited++) {
    await page.waitForTimeout(50)
    seen.push(...(await frames(page, 1, shown)).slice(1))
  }
  seen.push(...(await frames(page, after, shown)).slice(1))
  return seen
}

test('the numbers count to the ones GitHub gave, once, and a screen reader is only ever told the answer', async ({ page }) => {
  await page.clock.install()
  const problems = await open(page, '/?lang=en')
  await fetchTheNumbers(page)
  // What is in the document for anything that reads it is the number itself, from the moment there is one;
  // what is drawn has not moved yet, because nobody has seen it.
  const spoken = page.locator('#github [data-stat] .count > .sr-only')
  await expect(spoken).toHaveText(LANDED)
  expect(await states(page)).toEqual(['waiting', 'waiting', 'waiting', 'waiting', 'waiting'])

  // From here the frames are dealt out by hand, so every run sees the same count.
  await freeze(page)
  await seeTheNumbers(page)
  const seen = await watchTheCount(page, 220)
  expect(seen[seen.length - 1]).toEqual(LANDED)
  expect(await states(page)).toEqual(['done', 'done', 'done', 'done', 'done'])
  await expect(spoken).toHaveText(LANDED)

  for (const [i, landed] of LANDED.entries()) {
    const row = changes(seen.map((frame) => frame[i]!))
    const numbers = row.map(Number)
    expect(numbers.every(Number.isInteger), `stat ${i}: ${row.join(' ')}`).toBe(true)
    expect(row[row.length - 1], `stat ${i}`).toBe(landed)
    const down = i === LANDED.length - 1
    // Each one only ever moves towards its number: up to a count, back to a year.
    for (let j = 1; j < numbers.length; j++) expect(down ? numbers[j]! < numbers[j - 1]! : numbers[j]! > numbers[j - 1]!, `stat ${i}: ${row.join(' ')}`).toBe(true)
  }
  const [repos, , , contributions, since] = LANDED.map((_, i) => changes(seen.map((frame) => frame[i]!)))
  // They are seen on their way, from nought, not just at the end.
  expect(repos![0]).toBe('0')
  expect(repos!.length).toBeGreaterThan(20)
  expect(contributions!.length).toBeGreaterThan(40)
  // The year is counted back to from this one, a year at a time.
  expect(Number(since![0])).toBeGreaterThan(joined)
  expect(since!.length).toBe(Number(since![0]) - joined + 1)
  // A small number is there before a large one: the row lands from the left.
  const landedAt = (i: number) => seen.findIndex((frame) => frame[i] === LANDED[i])
  expect(landedAt(1)).toBeLessThan(landedAt(0))
  expect(landedAt(0)).toBeLessThan(landedAt(3))

  // Once: leaving and coming back does not run them again.
  await scrollTo(page, 'home')
  await page.waitForTimeout(300)
  await seeTheNumbers(page)
  await page.waitForTimeout(600)
  expect(changes((await frames(page, 80, shown)).map((frame) => frame.join(' ')))).toEqual([LANDED.join(' ')])
  expect(await states(page)).toEqual(['done', 'done', 'done', 'done', 'done'])
  expect(problems).toEqual([])
})

test('the contribution graph draws in as a wave from the oldest week to the newest', async ({ page }) => {
  const problems = await open(page, '/?lang=en')
  await scrollTo(page, 'github')
  const graph = page.locator('#github .contrib')
  await graph.scrollIntoViewIfNeeded()
  await expect(graph).toHaveAttribute('data-visible', 'true')

  // When each cell joins: read off the cells themselves, column by column.
  const delays = await graph.locator('.contrib-col').evaluateAll((columns) =>
    columns.map((column) => [...column.querySelectorAll<HTMLElement>('.contrib-cell')].map((cell) => parseFloat(getComputedStyle(cell).animationDelay) * 1000)),
  )
  expect(delays.length).toBeGreaterThanOrEqual(26)
  expect(delays[0]![0]).toBe(0)
  // The newest week starts 900 ms after the oldest, on a phone's half year and on a desktop's whole one.
  expect(delays[delays.length - 1]![0]).toBeCloseTo(900, 0)
  for (const [c, column] of delays.entries()) {
    expect(column).toHaveLength(7)
    for (const [r, delay] of column.entries()) {
      if (c > 0) expect(delay, `column ${c}, row ${r}`).toBeGreaterThan(delays[c - 1]![r]!)
      if (r > 0) expect(delay, `column ${c}, row ${r}`).toBeGreaterThan(column[r - 1]!)
    }
  }

  // It ends with every cell in place and the light that ran ahead of it gone.
  const last = graph.locator('.contrib-col').last().locator('.contrib-cell').last()
  // The last cell is drawn before it has finished landing: it overshoots, then settles.
  await expect.poll(() => last.evaluate((cell) => getComputedStyle(cell).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/)
  expect(await last.evaluate((cell) => Number(getComputedStyle(cell).opacity))).toBe(1)
  await expect.poll(() => graph.locator('.contrib-sheen').evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(0)
  // The total over it counted up alongside.
  await expect(page.locator('#github h3 + p .count > [aria-hidden]')).toHaveText(String(github.contributions.total.lastYear))
  await expect(page.locator('#github h3 + p .count > .sr-only')).toHaveText(String(github.contributions.total.lastYear))
  expect(problems).toEqual([])
})

test('the language bars grow, and their shares count up, when the list is seen', async ({ page }) => {
  const problems = await open(page, '/?lang=en')
  await scrollTo(page, 'github')
  const list = page.locator('#github .lang-bars')
  await list.scrollIntoViewIfNeeded()
  await expect(list).toHaveAttribute('data-visible', 'true')
  const bars = list.locator('.lang-bar')
  await expect(bars).toHaveCount(3)
  await expect.poll(() => bars.last().evaluate((bar) => getComputedStyle(bar).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)')
  await expect(list.locator('.count > [aria-hidden]')).toHaveText(['33%', '33%', '33%'])
  await expect(list.locator('.count > .sr-only')).toHaveText(['33%', '33%', '33%'])
  expect(problems).toEqual([])
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('every number stands at its value and the graph is simply there', async ({ page }) => {
    await page.clock.install()
    const problems = await open(page, '/?lang=en')
    await fetchTheNumbers(page)
    // Standing at its value before anyone has seen it, and still standing there after.
    expect(await page.evaluate(shown)).toEqual(LANDED)
    expect(await states(page)).toEqual(['done', 'done', 'done', 'done', 'done'])
    await freeze(page)
    await seeTheNumbers(page)
    await page.waitForTimeout(600)
    expect(changes((await frames(page, 120, shown)).map((frame) => frame.join(' ')))).toEqual([LANDED.join(' ')])

    const graph = page.locator('#github .contrib')
    await graph.scrollIntoViewIfNeeded()
    const cell = graph.locator('.contrib-col').last().locator('.contrib-cell').last()
    expect(await cell.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
    expect(await cell.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1)
    expect(await graph.locator('.contrib-sheen').evaluate((el) => getComputedStyle(el).display)).toBe('none')
    expect(await page.locator('#github .lang-bar').first().evaluate((el) => getComputedStyle(el).transform)).toBe('none')
    expect(problems).toEqual([])
  })
})
