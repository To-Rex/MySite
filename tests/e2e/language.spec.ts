import { expect, test, type Locator, type Page } from '@playwright/test'
import { de } from '../../src/i18n/locales/de'
import { en } from '../../src/i18n/locales/en'
import { oz } from '../../src/i18n/locales/oz'
import { ru } from '../../src/i18n/locales/ru'
import { uz } from '../../src/i18n/locales/uz'
import { open } from './site'
import { changes, frames, freeze } from './time'

/**
 * A change of language, watched. The state changes at once; what is on screen
 * turns into its translation letter by letter over the next second; and it
 * ends as exactly the page that language is served as.
 *
 * The second is dealt out a frame at a time (`time.ts`), so what each test
 * sees on the way does not depend on how fast the machine draws.
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

/** The words of a link to a section: in the header the link is nothing else, in the phone's menu it also carries a number. */
const linkTo = (section: string, isMobile: boolean) => (isMobile ? `#mobile-menu a[href="#${section}"] > span:first-child` : `header nav a[href="#${section}"]`)

/** What the watched elements say, whether the page says it is changing, and how dim it is. Runs in the page. */
const look = (watched: Record<string, string>) => ({
  said: Object.fromEntries(Object.entries(watched).map(([name, selector]) => [name, document.querySelector(selector)?.textContent ?? ''])),
  morphing: document.documentElement.hasAttribute('data-lang-morph'),
  busy: document.body.getAttribute('aria-busy') === 'true',
  dim: Number(getComputedStyle(document.getElementById('main')!).opacity),
})

const count = (text: string) => Array.from(text).length
/** Two and a half seconds of frames: longer than any change takes. */
const A_CHANGE = 160

test('a change of language is shown letter by letter, and ends as the page that language is served as', async ({ page, context, isMobile }) => {
  await page.clock.install()
  const problems = await open(page, '/?lang=en')
  const scope = await controls(page, isMobile)
  const link = linkTo('about', isMobile)
  await expect(page.locator(link)).toHaveText(en.nav.about)

  await freeze(page)
  await scope.locator('button[lang="de"]').click()
  // The language itself does not wait for anything: no frame has gone by yet.
  expect(await page.locator('html').getAttribute('lang')).toBe('de')
  await expect(page).toHaveTitle(de.meta.title)
  const seen = await frames(page, A_CHANGE, look, { link, skip: 'a[href="#main"]' })

  const steps = changes(seen.map((frame) => frame.said.link!))
  expect(steps[0]).toBe(en.nav.about)
  expect(steps[steps.length - 1]).toBe(de.nav.about)
  // It was something else on the way — several things — and only ever grew: "About" is the shorter.
  expect(steps.length).toBeGreaterThan(5)
  for (let i = 1; i < steps.length; i++) expect(count(steps[i]!), steps.join(' → ')).toBeGreaterThanOrEqual(count(steps[i - 1]!))
  // What a screen reader alone is given was the new line from the first moment, never anything on its way there.
  expect(changes(seen.map((frame) => frame.said.skip!))).toEqual([de.common.skipToContent])
  // While it was changing the page said so, to styles and to a screen reader, and stopped saying so when it was over.
  expect(seen[0]).toMatchObject({ morphing: true, busy: true })
  expect(seen[seen.length - 1]).toMatchObject({ morphing: false, busy: false })
  // And the page did not dim over it: the letters are the transition.
  expect(Math.min(...seen.map((frame) => frame.dim))).toBe(1)

  // The same page as a visit in that language: every word of it, wherever on the page.
  await page.clock.resume()
  const fresh = await context.newPage()
  await open(fresh, '/?lang=de')
  for (const part of ['main', 'footer']) {
    expect(await page.locator(part).evaluate((el) => el.textContent), part).toBe(await fresh.locator(part).evaluate((el) => el.textContent))
  }
  await fresh.close()
  expect(problems).toEqual([])
})

test('between the two Uzbek alphabets only the letters that differ change, each in one go', async ({ page, isMobile }) => {
  await page.clock.install()
  const problems = await open(page, '/?lang=uz')
  const scope = await controls(page, isMobile)
  const link = linkTo('contact', isMobile)
  const from = uz.nav.contact
  const to = oz.nav.contact
  // The word has two of the four spellings in it: gʻ and sh.
  expect(from).not.toBe(to)
  expect(count(from) - count(to)).toBe(2)
  await expect(page.locator(link)).toHaveText(from)

  await freeze(page)
  await scope.locator(`button[lang="${NEW_LATIN}"]`).click()
  const steps = changes((await frames(page, A_CHANGE, look, { link })).map((frame) => frame.said.link!))
  // Old, one spelling turned over, both: nothing was ever on screen that is in neither alphabet.
  expect(steps).toHaveLength(3)
  expect(steps[0]).toBe(from)
  expect(steps[2]).toBe(to)
  expect(count(steps[1]!)).toBe(count(from) - 1)
  for (const letter of Array.from(steps[1]!)) expect(from + to).toContain(letter)
  // The front runs left to right: gʻ has turned into ğ, and sh is still two letters.
  expect(steps[1]!.startsWith(to.slice(0, 3))).toBe(true)
  expect(steps[1]!.endsWith(from.slice(-2))).toBe(true)
  expect(problems).toEqual([])
})

test('a second change made while the first is on its way lands on the second language', async ({ page, isMobile }) => {
  await page.clock.install()
  const problems = await open(page, '/?lang=en')
  const scope = await controls(page, isMobile)
  const link = linkTo('about', isMobile)

  await freeze(page)
  await scope.locator('button[lang="de"]').click()
  // Part of the way there…
  const first = await frames(page, 12, look, { link })
  expect(first[first.length - 1]!.said.link).not.toBe(en.nav.about)
  expect(first[first.length - 1]!.said.link).not.toBe(de.nav.about)
  // …and the reader changes their mind. The first is put down as whole German, and the second starts from that.
  await scope.locator('button[lang="ru"]').click()
  expect(await page.locator('html').getAttribute('lang')).toBe('ru')
  const second = await frames(page, A_CHANGE, look, { link })
  expect(second[0]!.said.link).toBe(de.nav.about)
  expect(second[second.length - 1]).toMatchObject({ said: { link: ru.nav.about }, morphing: false, busy: false })
  await expect(page).toHaveTitle(ru.meta.title)

  // And straight back, twice over, as fast as it can be pressed.
  await scope.locator('button[lang="en"]').click()
  await scope.locator('button[lang="de"]').click()
  await scope.locator('button[lang="en"]').click()
  const last = await frames(page, A_CHANGE, look, { link })
  expect(last[last.length - 1]).toMatchObject({ said: { link: en.nav.about }, morphing: false, busy: false })
  expect(problems).toEqual([])
})

test('text that is not on screen is simply replaced', async ({ page, isMobile }) => {
  test.skip(isMobile, 'on a phone the switcher is in a menu that covers the page: nothing behind it is animated, which the first test covers')
  await page.clock.install()
  const problems = await open(page, '/?lang=en')
  const watched = { far: 'footer p', near: 'header nav a[href="#about"]' }
  const before = await page.locator(watched.far).first().textContent()
  await freeze(page)
  await page.locator('header button[lang="de"]').click()
  const seen = await frames(page, A_CHANGE, look, watched)
  // The footer is a dozen screens down: its words were the new ones at once.
  const far = changes(seen.map((frame) => frame.said.far!))
  expect(far).toHaveLength(1)
  expect(far[0]).not.toBe(before)
  expect(changes(seen.map((frame) => frame.said.near!)).length).toBeGreaterThan(5)
  expect(problems).toEqual([])
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the new language is simply there: no letters on their way, and no dim cut to a flash', async ({ page, isMobile }) => {
    await page.clock.install()
    const problems = await open(page, '/?lang=en')
    const scope = await controls(page, isMobile)
    const link = linkTo('about', isMobile)
    await expect(page.locator(link)).toHaveText(en.nav.about)
    await freeze(page)
    await scope.locator('button[lang="de"]').click()
    const seen = await frames(page, 60, look, { link })
    expect(changes(seen.map((frame) => frame.said.link!))).toEqual([de.nav.about])
    expect(seen.some((frame) => frame.morphing || frame.busy)).toBe(false)
    expect(Math.min(...seen.map((frame) => frame.dim))).toBe(1)
    expect(problems).toEqual([])
  })
})
