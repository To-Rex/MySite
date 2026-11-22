import { expect, test, type Page } from '@playwright/test'
import { github, open, scrollTo } from './site'

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

/**
 * Starts writing down everything each stat shows, frame by frame, from before
 * it exists. A count is over in a second or so; polling from the test would
 * see its end and little else.
 */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[][] = []
    Object.assign(window, { __seen: seen })
    const tick = () => {
      document.querySelectorAll('#github [data-stat] .count > [aria-hidden]').forEach((el, i) => {
        const text = el.textContent ?? ''
        const row = (seen[i] ??= [])
        if (row[row.length - 1] !== text) row.push(text)
      })
      requestAnimationFrame(tick)
    }
    tick()
  })
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

const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: string[][] }).__seen)
const states = (page: Page) => page.locator('#github [data-stat] .count').evaluateAll((all) => all.map((el) => el.getAttribute('data-count')))
const landed = (page: Page) => expect.poll(() => states(page)).toEqual(['done', 'done', 'done', 'done', 'done'])

test('the numbers count to the ones GitHub gave, once, and a screen reader is only ever told the answer', async ({ page }) => {
  const problems = await open(page, '/?lang=en')
  await record(page)
  await seeTheNumbers(page)
  // What is in the document for anything that reads it is the number itself, from the moment there is one.
  const spoken = page.locator('#github [data-stat] .count > .sr-only')
  await expect(spoken).toHaveText(LANDED)
  expect(await page.locator('#github [data-stat] .count > [aria-hidden]').count()).toBe(LANDED.length)
  await landed(page)
  await expect(page.locator('#github [data-stat] .count > [aria-hidden]')).toHaveText(LANDED)

  const rows = await seen(page)
  expect(rows).toHaveLength(LANDED.length)
  for (const [i, row] of rows.entries()) {
    const numbers = row.map(Number)
    expect(numbers.every(Number.isInteger), `stat ${i}: ${row.join(' ')}`).toBe(true)
    expect(row[row.length - 1], `stat ${i}`).toBe(LANDED[i])
    const down = i === LANDED.length - 1
    // Each one only ever moves towards its number: up to a count, back to a year.
    for (let j = 1; j < numbers.length; j++) expect(down ? numbers[j]! < numbers[j - 1]! : numbers[j]! > numbers[j - 1]!, `stat ${i}: ${row.join(' ')}`).toBe(true)
  }
  // The big ones are seen on their way, not just at the end.
  expect(rows[0]!.length).toBeGreaterThan(4)
  expect(rows[3]!.length).toBeGreaterThan(8)
  expect(Number(rows[0]![0])).toBeLessThan(github.profile.public_repos)
  // The year is counted back to from this one.
  expect(Number(rows[4]![0])).toBeGreaterThan(joined)

  // Once: leaving and coming back does not run them again.
  await page.evaluate(() => (window as unknown as { __seen: string[][] }).__seen.forEach((row) => row.splice(0, row.length - 1)))
  await scrollTo(page, 'home')
  await page.waitForTimeout(300)
  await seeTheNumbers(page)
  await page.waitForTimeout(900)
  expect(await seen(page)).toEqual(LANDED.map((value) => [value]))
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
    const problems = await open(page, '/?lang=en')
    await record(page)
    await seeTheNumbers(page)
    await landed(page)
    await page.waitForTimeout(500)
    // Nothing was ever shown on the way: each stat has only ever said its number.
    expect(await seen(page)).toEqual(LANDED.map((value) => [value]))

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
