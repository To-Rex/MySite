import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@playwright/test'
import { SECTIONS, introDone, mockGithub, scrollTo } from './site'

/**
 * Pictures, not assertions: `npm run shots` writes one screenshot per section,
 * per theme, per viewport into `test-results/shots/` for a person — or Claude —
 * to look at. Nothing here can fail a build; it is how a visual change gets
 * checked before it is called done.
 *
 * The shim below is the part that matters. A headless browser reports a coarse
 * pointer and four cores, which `useDeviceTier` reads as a `low`-tier device:
 * no bump mapping, no shadows, the cheapest meshes. Screenshots taken that way
 * show a surface no desktop visitor ever sees, and tuning anything from them is
 * meaningless. This makes the test browser look like the machine it stands for.
 */

/*
 * `npm run shots` runs these two at a time. Each one ends by playing the valley
 * at the quality a desktop gets, and four of those starting at once on one
 * card — burning forest, crater and all — took over a minute to get past
 * their opening frame.
 */

const OUT = join('test-results', 'shots')

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, touch: false, cores: 8, memory: 8 },
  { name: 'phone', width: 390, height: 844, touch: true, cores: 8, memory: 6 },
] as const

/** Long enough for the creature meshes to come back from the worker and settle. */
const SETTLE = 4500

for (const viewport of VIEWPORTS) {
  for (const theme of ['dark', 'light'] as const) {
    test(`${viewport.name} · ${theme}`, async ({ browser }) => {
      test.setTimeout(420_000)
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        hasTouch: viewport.touch,
        isMobile: viewport.touch,
        colorScheme: theme,
      })
      await context.addInitScript(
        ({ touch, cores, memory }) => {
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores })
          Object.defineProperty(navigator, 'deviceMemory', { get: () => memory })
          const real = window.matchMedia.bind(window)
          const answers: Record<string, boolean> = { '(pointer: coarse)': touch, '(pointer: fine)': !touch }
          window.matchMedia = (query: string) => {
            const list = real(query)
            const forced = answers[query.trim()]
            if (forced === undefined) return list
            return new Proxy(list, {
              get(target, key) {
                if (key === 'matches') return forced
                // Native methods refuse to run with the proxy as `this`.
                const value: unknown = Reflect.get(target, key, target)
                return typeof value === 'function' ? value.bind(target) : value
              },
            })
          }
          try {
            sessionStorage.setItem('dh.intro.seen', '1')
          } catch {
            /* the long intro plays instead */
          }
        },
        { touch: viewport.touch, cores: viewport.cores, memory: viewport.memory },
      )

      const page = await context.newPage()
      await mockGithub(page)
      await page.goto(`/?lang=en&theme=${theme}`)
      await introDone(page)
      await page.waitForTimeout(SETTLE)

      mkdirSync(OUT, { recursive: true })
      const shot = (name: string) => page.screenshot({ path: join(OUT, `${viewport.name}-${theme}-${name}.png`) })

      // The long walk, once in each era: it has no place in the list below,
      // being a scene the page scrolls through and not a section it scrolls to.
      // First, so that the sections still end at the bottom of the page: the
      // phone's menu button is only there to press after scrolling up.
      const walk = page.locator('#evolution')
      if (await walk.count()) {
        for (const [at, name] of [
          [0.08, 'fire'],
          [0.2, 'mouth'],
          [0.41, 'hunt'],
          [0.56, 'field'],
          [0.76, 'city'],
          [0.93, 'now'],
        ] as const) {
          await page.evaluate((p) => {
            const el = document.getElementById('evolution')!
            const top = el.getBoundingClientRect().top + window.scrollY
            window.scrollTo(0, Math.round(top + p * (el.offsetHeight - (el.firstElementChild as HTMLElement).clientHeight)))
          }, at)
          await page.waitForTimeout(at === 0.08 ? 6000 : 1600)
          await shot(`14-walk-${name}`)
        }
      }

      for (const [index, id] of SECTIONS.entries()) {
        // Each section framed from its own top edge, so two runs can be compared.
        await scrollTo(page, id)
        // The universe takes a while to fly in, and the GitHub numbers a while to finish counting.
        await page.waitForTimeout(id === 'skills' || id === 'github' ? 2500 : 1200)
        await shot(`${String(index + 1).padStart(2, '0')}-${id}`)
      }

      // The two overlays: states nobody scrolls past, so nothing above shows them.
      const card = page.getByRole('button', { name: 'Torex Local Storage — Details' })
      await card.scrollIntoViewIfNeeded()
      await card.click()
      await page.getByRole('dialog').waitFor()
      await page.waitForTimeout(900)
      await shot('10-project-dialog')
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })

      if (viewport.touch) {
        await page.locator('header button[aria-controls="mobile-menu"]').click()
        await page.locator('#mobile-menu').waitFor()
        await page.waitForTimeout(1200)
        await shot('11-menu')
      }

      // The extinction cinematic, at the moments that matter, started the way a
      // visitor starts it.
      await page.goto(`/?lang=en&theme=${theme}`)
      await introDone(page)
      await page.locator('[data-valley]').waitFor({ state: 'attached', timeout: 90_000 })
      await page.locator('header a[aria-label="Dilshodjon Haydarov"]').click()
      await page.locator('[data-valley="open"]').waitFor({ state: 'attached', timeout: 60_000 })
      const start = Date.now()
      for (const [at, name] of [
        [4.5, 'graze'],
        [8.6, 'streak'],
        [9.6, 'impact'],
        [12, 'die'],
        [15.03, 'lightning'],
        [18.8, 'aftermath'],
      ] as const) {
        await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - start)))
        await shot(`13-valley-${name}`)
      }

      // An address that does not exist, after the opening has played out.
      await page.goto(`/no-such-page?lang=en&theme=${theme}`)
      await page.getByRole('button', { name: 'Make it roar' }).waitFor({ timeout: 300_000 })
      await page.waitForTimeout(SETTLE)
      await shot('12-not-found')
      await context.close()
    })
  }
}
