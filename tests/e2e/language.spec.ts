import { expect, test, type Locator, type Page } from '@playwright/test'
import { de } from '../../src/i18n/locales/de'
import { en } from '../../src/i18n/locales/en'
import { oz } from '../../src/i18n/locales/oz'
import { ru } from '../../src/i18n/locales/ru'
import { uz } from '../../src/i18n/locales/uz'
import { open, scrollTo, type SECTIONS } from './site'
import { changes, frames, freeze, withoutWebGL } from './time'

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

/**
 * A heading in masked words (`SplitText`): what it says, what it is to a
 * screen reader, how it lies, and how far anything of it is from where it
 * rests. Runs in the page.
 */
const lookAtHeading = (selector: string) => {
  const root = document.querySelector(selector)!
  const words = [...root.children].filter((child) => child.tagName !== 'BR')
  const units = [...root.querySelectorAll(':scope > span > span > span')]
  return {
    said: root.textContent ?? '',
    label: root.getAttribute('aria-label') ?? '',
    words: words.length,
    units: units.length,
    lines: new Set(words.map((word) => Math.round(word.getBoundingClientRect().top))).size,
    height: Math.round(root.parentElement!.getBoundingClientRect().height),
    // Whether it is being told where its lines break, or is left to fall into them as it does on any visit.
    told: root.querySelector(':scope > br') !== null || getComputedStyle(root).whiteSpace === 'nowrap',
    // A word or a letter that had been made again would be under its mask, on its way up.
    astray: Math.max(0, ...units.map((unit) => Math.abs(new DOMMatrixReadOnly(getComputedStyle(unit).transform).m42))),
    wider: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    morphing: document.documentElement.hasAttribute('data-lang-morph'),
  }
}

/**
 * Brings a section's heading on screen and waits until it has risen out of
 * its masks — every word at rest — and the header, which steps aside on the
 * way down the page, is back.
 *
 * The header comes back for a step up the page. It has to have seen the way
 * down first: on a busy machine both scrolls can land before it has looked at
 * either, and then all it has seen is a page that went down, and it stays
 * away. So the step back waits until the header has gone.
 */
async function risen(page: Page, section: (typeof SECTIONS)[number], heading: string): Promise<void> {
  if (section !== 'home') {
    await scrollTo(page, section)
    await page.waitForFunction(() => document.querySelector('header')!.getBoundingClientRect().top < -40, undefined, { timeout: 10_000 }).catch(() => {})
    await page.evaluate(() => window.scrollBy(0, -48))
  }
  await page.waitForFunction((selector) => {
    const units = [...document.querySelectorAll(`${selector} > span > span > span`)]
    const atRest = (unit: Element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(unit).transform)
      return Math.abs(matrix.m42) < 0.01 && Math.abs(matrix.m12) < 0.0001
    }
    return units.length > 0 && units.every(atRest) && Math.abs(document.querySelector('header')!.getBoundingClientRect().top) < 0.5
  }, heading)
}

/** Whether a list of numbers only ever goes one way. */
const oneWay = (values: readonly number[]) => values.every((value, i) => i === 0 || value >= values[i - 1]!) || values.every((value, i) => i === 0 || value <= values[i - 1]!)

const count = (text: string) => Array.from(text).length
/** A second and three quarters of frames: longer than any change takes, which is a third of a second to start and one more to run. */
const A_CHANGE = 110
/** What a heading near the top of the screen takes, and a little more: it starts at once and is a line or two long. */
const A_HEADING = 72

// Frames are dealt out by hand here, and a frame is cheap only if no canvas has to draw it.
test.beforeEach(async ({ context }) => withoutWebGL(context))

test('a change of language is shown letter by letter, and ends as the page that language is served as', async ({ page, context, isMobile }) => {
  await page.clock.install()
  const problems = await open(page, '/?lang=en')
  expect(await page.locator('canvas').count()).toBe(0)
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

test('a heading is walked to its translation letter by letter, in the words it rose in', async ({ page, isMobile }) => {
  test.skip(isMobile, 'on a phone the switcher is in a menu that covers the page: the heading under it is simply replaced, which the next test watches')
  await page.clock.install()
  const problems = await open(page, '/?lang=en')
  const heading = '#about-title [data-morph="own"]'
  await risen(page, 'about', heading)
  await expect(page.locator(heading)).toHaveText(en.about.title)
  const before = await page.evaluate(lookAtHeading, heading)
  expect(before).toMatchObject({ words: 4, told: false })

  await freeze(page)
  await page.locator('header button[lang="de"]').click()
  const seen = await frames(page, A_HEADING, lookAtHeading, heading)

  const steps = changes(seen.map((frame) => frame.said))
  expect(steps[0]).toBe(en.about.title)
  expect(steps[steps.length - 1]).toBe(de.about.title)
  expect(steps.length).toBeGreaterThan(8)
  // Word against word: four words in English, four in German, and four at every step between.
  for (const step of steps) expect(step.split(' '), step).toHaveLength(4)
  // To a screen reader it was the German from the first moment, never anything on its way there.
  expect(changes(seen.map((frame) => frame.label))).toEqual([de.about.title])
  // Nothing rose out of its mask a second time: every word stayed exactly where it rests.
  expect(Math.max(...seen.map((frame) => frame.astray))).toBeLessThan(0.5)
  // Taken hold of, it lay exactly as it had by itself: nothing moved before a letter did.
  expect(seen[0]).toMatchObject({ said: en.about.title, lines: before.lines, height: before.height, told: true, morphing: true })
  // Its lines, and so everything below it, moved one way only — and the page was never wider than the screen.
  expect(oneWay(seen.map((frame) => frame.lines)), changes(seen.map((frame) => frame.lines)).join(' → ')).toBe(true)
  expect(oneWay(seen.map((frame) => frame.height)), changes(seen.map((frame) => frame.height)).join(' → ')).toBe(true)
  expect(Math.max(...seen.map((frame) => frame.wider))).toBeLessThanOrEqual(0)
  // And it is let go of when it is its translation: no line given, the same four words, lying as they fall on any visit in German.
  expect(seen[seen.length - 1]).toMatchObject({ said: de.about.title, words: 4, units: 4, told: false })
  expect(problems).toEqual([])
})

test('on a phone, under the menu, a heading is simply its translation — and has not risen again', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'on a desktop the switcher is in the header and the heading is in view: the test above')
  await page.clock.install()
  const problems = await open(page, '/?lang=en')
  const heading = '#about-title [data-morph="own"]'
  await risen(page, 'about', heading)
  const scope = await controls(page, true)

  await freeze(page)
  await scope.locator('button[lang="de"]').click()
  const seen = await frames(page, 40, lookAtHeading, heading)
  // Nobody could have seen it change: it did not. It was the German at once, with every word where it rests.
  expect(changes(seen.map((frame) => frame.said))).toEqual([de.about.title])
  expect(changes(seen.map((frame) => frame.label))).toEqual([de.about.title])
  expect(Math.max(...seen.map((frame) => frame.astray))).toBeLessThan(0.5)
  expect(problems).toEqual([])
})

test('the name, in letters each in its own mask, turns over only the spelling that differs between the two alphabets', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the name is under the menu on a phone')
  await page.clock.install()
  const problems = await open(page, '/?lang=uz')
  const name = '#hero-title [data-morph="own"]'
  await risen(page, 'home', name)
  expect(uz.hero.firstName).not.toBe(oz.hero.firstName)

  await freeze(page)
  await page.locator(`header button[lang="${NEW_LATIN}"]`).click()
  const seen = await frames(page, A_CHANGE, lookAtHeading, name)
  // "sh" is "ş" in one go: ten letters, then nine, and nothing on the page that is in neither alphabet.
  expect(changes(seen.map((frame) => frame.said))).toEqual([uz.hero.firstName, oz.hero.firstName])
  expect(changes(seen.map((frame) => frame.units))).toEqual([count(uz.hero.firstName), count(oz.hero.firstName)])
  expect(Math.max(...seen.map((frame) => frame.astray))).toBeLessThan(0.5)
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
    const seen = await frames(page, 20, look, { link })
    expect(changes(seen.map((frame) => frame.said.link!))).toEqual([de.nav.about])
    expect(seen.some((frame) => frame.morphing || frame.busy)).toBe(false)
    expect(Math.min(...seen.map((frame) => frame.dim))).toBe(1)
    expect(problems).toEqual([])
  })
})
