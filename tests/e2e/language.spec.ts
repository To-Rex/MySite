import { expect, test, type Locator, type Page } from '@playwright/test'
import { de } from '../../src/i18n/locales/de'
import { en } from '../../src/i18n/locales/en'
import { oz } from '../../src/i18n/locales/oz'
import { ru } from '../../src/i18n/locales/ru'
import { uz } from '../../src/i18n/locales/uz'
import { open } from './site'

/**
 * A change of language, watched. The state changes at once; what is on screen
 * turns into its translation letter by letter over the next second; and it
 * ends as exactly the page that language is served as.
 */

const NEW_LATIN = 'uz-Latn-UZ-x-yangi'

/** The switcher and the links beside it: in the header on a desktop, in the menu on a phone. */
async function controls(page: Page, isMobile: boolean): Promise<Locator> {
  if (!isMobile) return page.locator('header')
  await page.locator('header button[aria-controls="mobile-menu"]').click()
  const menu = page.locator('#mobile-menu')
  await expect(menu.locator('a[href="#about"]')).toBeVisible()
  // Its own entrance has to be over: text that is still arriving is not yet text on screen.
  await page.waitForTimeout(900)
  return menu
}

/**
 * Starts writing down everything the matched elements say, frame by frame.
 * A change is over in a second; polling from the test would see how it ended
 * and little of how it got there.
 */
async function record(page: Page, selectors: Record<string, string>): Promise<void> {
  await page.evaluate((watched) => {
    const said: Record<string, string[]> = {}
    const main: number[] = []
    const marked = { morphing: false, busy: false }
    Object.assign(window, { __said: said, __dim: main, __marked: marked })
    const tick = () => {
      for (const [name, selector] of Object.entries(watched)) {
        const text = document.querySelector(selector)?.textContent ?? ''
        const row = (said[name] ??= [])
        if (row[row.length - 1] !== text) row.push(text)
      }
      const page = document.getElementById('main')
      if (page) main.push(Number(getComputedStyle(page).opacity))
      // Whether the page ever said it was changing: over too soon to be caught from outside.
      marked.morphing ||= document.documentElement.hasAttribute('data-lang-morph')
      marked.busy ||= document.body.getAttribute('aria-busy') === 'true'
      requestAnimationFrame(tick)
    }
    tick()
  }, selectors)
}

const said = (page: Page) => page.evaluate(() => (window as unknown as { __said: Record<string, string[]> }).__said)
const dim = (page: Page) => page.evaluate(() => Math.min(...(window as unknown as { __dim: number[] }).__dim))
const marked = (page: Page) => page.evaluate(() => (window as unknown as { __marked: { morphing: boolean; busy: boolean } }).__marked)

/** The words of a link to a section: in the header the link is nothing else, in the phone's menu it also carries a number. */
const linkTo = (section: string, isMobile: boolean) => (isMobile ? `#mobile-menu a[href="#${section}"] > span:first-child` : `header nav a[href="#${section}"]`)
const count = (text: string) => Array.from(text).length

/** Waits for a change that is on its way to be over. */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('html')).not.toHaveAttribute('data-lang-morph')
  await expect(page.locator('body')).not.toHaveAttribute('aria-busy')
}

test('a change of language is shown letter by letter, and ends as the page that language is served as', async ({ page, context, isMobile }) => {
  const problems = await open(page, '/?lang=en')
  const scope = await controls(page, isMobile)
  const link = linkTo('about', isMobile)
  await expect(page.locator(link)).toHaveText(en.nav.about)
  await record(page, { link, skip: 'a[href="#main"]' })

  await scope.locator('button[lang="de"]').click()
  // The language itself does not wait for anything.
  expect(await page.locator('html').getAttribute('lang')).toBe('de')
  await expect(page.locator(link)).toHaveText(de.nav.about)
  await settled(page)
  // While it was changing the page said so, to styles and to a screen reader.
  expect(await marked(page)).toEqual({ morphing: true, busy: true })

  const rows = await said(page)
  const steps = rows.link!
  expect(steps[0]).toBe(en.nav.about)
  expect(steps[steps.length - 1]).toBe(de.nav.about)
  // It was something else on the way — several things — and only ever grew: "About" is the shorter.
  expect(steps.length).toBeGreaterThan(4)
  for (let i = 1; i < steps.length; i++) expect(count(steps[i]!), steps.join(' → ')).toBeGreaterThanOrEqual(count(steps[i - 1]!))
  // What a screen reader alone is given was the old line and then the new one, never anything between.
  expect(rows.skip).toEqual([en.common.skipToContent, de.common.skipToContent])
  // And the page did not dim over it: the letters are the transition.
  expect(await dim(page)).toBe(1)

  // The same page as a visit in that language: every word of it, wherever on the page.
  const fresh = await context.newPage()
  await open(fresh, '/?lang=de')
  for (const part of ['main', 'footer']) {
    expect(await page.locator(part).evaluate((el) => el.textContent), part).toBe(await fresh.locator(part).evaluate((el) => el.textContent))
  }
  await fresh.close()
  expect(problems).toEqual([])
})

test('between the two Uzbek alphabets only the letters that differ change, each in one go', async ({ page, isMobile }) => {
  const problems = await open(page, '/?lang=uz')
  const scope = await controls(page, isMobile)
  const link = linkTo('contact', isMobile)
  const from = uz.nav.contact
  const to = oz.nav.contact
  // The word has two of the four spellings in it: gʻ and sh.
  expect(from).not.toBe(to)
  expect(count(from) - count(to)).toBe(2)
  await expect(page.locator(link)).toHaveText(from)
  await record(page, { link })

  await scope.locator(`button[lang="${NEW_LATIN}"]`).click()
  await expect(page.locator(link)).toHaveText(to)
  await settled(page)
  const steps = (await said(page)).link!
  expect(steps[0]).toBe(from)
  expect(steps[steps.length - 1]).toBe(to)
  // Old, one spelling turned over, both: nothing was ever on screen that is in neither alphabet.
  expect(steps).toHaveLength(3)
  expect(count(steps[1]!)).toBe(count(from) - 1)
  for (const letter of Array.from(steps[1]!)) expect(from + to).toContain(letter)
  expect(steps[1]!.startsWith(to.slice(0, 3))).toBe(true)
  expect(steps[1]!.endsWith(from.slice(-2))).toBe(true)
  expect(problems).toEqual([])
})

test('a second change made while the first is on its way lands on the second language', async ({ page, isMobile }) => {
  const problems = await open(page, '/?lang=en')
  const scope = await controls(page, isMobile)
  const link = page.locator(linkTo('about', isMobile))

  await scope.locator('button[lang="de"]').click()
  await page.waitForTimeout(120)
  await scope.locator('button[lang="ru"]').click()
  expect(await page.locator('html').getAttribute('lang')).toBe('ru')
  await expect(link).toHaveText(ru.nav.about)
  await settled(page)
  await expect(page).toHaveTitle(ru.meta.title)

  // And straight back, twice over, as fast as it can be pressed.
  await scope.locator('button[lang="en"]').click()
  await scope.locator('button[lang="de"]').click()
  await scope.locator('button[lang="en"]').click()
  await expect(link).toHaveText(en.nav.about)
  await settled(page)
  expect(problems).toEqual([])
})

test('text that is not on screen is simply replaced', async ({ page, isMobile }) => {
  test.skip(isMobile, 'on a phone the switcher is in a menu that covers the page: nothing behind it is animated, which the first test covers')
  const problems = await open(page, '/?lang=en')
  const far = 'footer p'
  await record(page, { far, near: 'header nav a[href="#about"]' })
  const before = await page.locator(far).first().textContent()
  await page.locator('header button[lang="de"]').click()
  await expect(page.locator('header nav a[href="#about"]')).toHaveText(de.nav.about)
  await settled(page)
  const rows = await said(page)
  // The footer is a dozen screens down: its words changed once.
  expect(rows.far).toHaveLength(2)
  expect(rows.far![0]).toBe(before)
  expect(rows.near!.length).toBeGreaterThan(3)
  expect(problems).toEqual([])
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the new language is simply there: no letters on their way, and no dim cut to a flash', async ({ page, isMobile }) => {
    const problems = await open(page, '/?lang=en')
    const scope = await controls(page, isMobile)
    const link = linkTo('about', isMobile)
    await record(page, { link })
    await scope.locator('button[lang="de"]').click()
    await expect(page.locator(link)).toHaveText(de.nav.about)
    await page.waitForTimeout(500)
    expect((await said(page)).link).toEqual([en.nav.about, de.nav.about])
    expect(await marked(page)).toEqual({ morphing: false, busy: false })
    expect(await dim(page)).toBe(1)
    expect(problems).toEqual([])
  })
})
