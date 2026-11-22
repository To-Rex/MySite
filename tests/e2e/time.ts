import type { BrowserContext, Page } from '@playwright/test'

/**
 * Time driven by hand, for the things that are over in a second.
 *
 * A count or a change of language runs for about that long, and what has to
 * be checked is what it showed on the way. Watched in real time, that depends
 * on how many frames the machine managed: a laptop draws sixty, and a CI
 * runner drawing three 3D scenes in software draws two or three — the count
 * goes 0, 38, 42 and a test that wanted to see it climb fails, though nothing
 * is wrong. So these tests stop the page's clock and deal the frames out one
 * at a time; every run then sees the same frames, at any speed.
 *
 * `page.clock.install()` has to come before the page is opened. Until
 * `freeze`, time runs as usual.
 *
 * And they run with no WebGL (`withoutWebGL`). A frame dealt out is a frame
 * every canvas on the page draws, and in software that is most of a second
 * each: the first version of these tests dealt two hundred of them and took
 * the whole suite past CI's fifteen minutes. None of what they watch is 3D,
 * and the page without WebGL is a page the site really serves.
 */

/**
 * Takes WebGL away from every page of a context, before any of them is
 * opened: the site then shows what it shows a browser that has none, and has
 * no canvases to draw.
 */
export async function withoutWebGL(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return /webgl/i.test(kind) ? null : (original as (...args: unknown[]) => unknown).call(this, kind, ...rest)
    } as typeof original
  })
}

/** One animation frame, in the milliseconds the page's clock is moved by. */
const FRAME = 16

/**
 * Stops the page's clock. Timers and animation frames now only run when
 * `frames` deals them out.
 *
 * A clock can only be stopped at a moment it has not reached yet, and it keeps
 * running while the request to stop it is on its way — so the moment asked for
 * is a little ahead, and further ahead if a busy machine was too slow for that.
 */
export async function freeze(page: Page): Promise<void> {
  for (const ahead of [250, 1000, 4000, 15_000]) {
    try {
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + ahead)
      return
    } catch (error) {
      if (!String(error).includes('to the past')) throw error
    }
  }
  throw new Error('the page clock could not be stopped: it stayed ahead of every moment asked for')
}

/**
 * Lets `count` animation frames go by, one at a time, and returns what `read`
 * saw in the page before the first and after each. `read` runs in the page,
 * and is handed `given`.
 */
export async function frames<T, G = undefined>(page: Page, count: number, read: (given: G) => T, given?: G): Promise<T[]> {
  const look = () => page.evaluate(read as (given: unknown) => T, given)
  const seen: T[] = [await look()]
  for (let i = 0; i < count; i++) {
    await page.clock.runFor(FRAME)
    seen.push(await look())
  }
  return seen
}

/** A list with every run of the same value reduced to one: what was shown, in the order it was shown. */
export function changes<T>(values: readonly T[]): T[] {
  return values.filter((value, i) => i === 0 || value !== values[i - 1])
}
