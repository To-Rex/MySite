import type { Page } from '@playwright/test'

/**
 * Shared setup for the browser tests: a GitHub that always answers the same
 * way, a list of everything that went wrong on the page, and a wait for the
 * intro to get out of the way.
 */

const CORS = { 'access-control-allow-origin': '*' }
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const day = (offset: number) => new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10)

export const github = {
  profile: {
    login: 'To-Rex',
    name: 'Dilshodjon Haydarov',
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    html_url: 'https://github.com/To-Rex',
    bio: null,
    public_repos: 42,
    followers: 7,
    following: 3,
    created_at: '2021-01-01T00:00:00Z',
    location: null,
    blog: null,
  },
  repos: [
    { id: 1, name: 'fixture-flutter-app', language: 'Dart', stargazers_count: 5 },
    { id: 2, name: 'fixture-api', language: 'Python', stargazers_count: 2 },
    { id: 3, name: 'fixture-site', language: 'TypeScript', stargazers_count: 1 },
  ].map((repo) => ({
    ...repo,
    full_name: `To-Rex/${repo.name}`,
    html_url: `https://github.com/To-Rex/${repo.name}`,
    description: null,
    forks_count: 0,
    fork: false,
    archived: false,
    pushed_at: '2026-01-10T00:00:00Z',
    updated_at: '2026-01-10T00:00:00Z',
    homepage: null,
  })),
  contributions: {
    total: { lastYear: 365 },
    contributions: Array.from({ length: 364 }, (_, i) => ({ date: day(i), count: i % 5, level: i % 5 })),
  },
}

/**
 * Answers for the three origins the page talks to. The requests still leave
 * the page, so the Content-Security-Policy still has to allow them — what is
 * replaced is only the reply, which keeps the suite off the 60-an-hour limit
 * and independent of what the real account looks like today.
 */
export async function mockGithub(page: Page): Promise<void> {
  await page.route('https://api.github.com/users/To-Rex', (route) => route.fulfill({ json: github.profile, headers: CORS }))
  await page.route('https://api.github.com/users/To-Rex/repos**', (route) =>
    route.fulfill({ json: new URL(route.request().url()).searchParams.get('page') === '1' ? github.repos : [], headers: CORS }),
  )
  await page.route('https://github-contributions-api.jogruber.de/**', (route) => route.fulfill({ json: github.contributions, headers: CORS }))
  await page.route('https://avatars.githubusercontent.com/**', (route) => route.fulfill({ contentType: 'image/png', body: PIXEL }))
}

/**
 * Everything that counts as the page being broken: an uncaught exception, a
 * console error — which is where a CSP violation shows up — a request for one
 * of our own files that failed, or a request to an origin nobody mocked.
 */
export function watch(page: Page): string[] {
  const problems: string[] = []
  const own = (url: string) => url.startsWith('http://127.0.0.1')
  page.on('pageerror', (error) => problems.push(`exception: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`)
  })
  page.on('response', (response) => {
    if (own(response.url()) && response.status() >= 400) problems.push(`${response.status()}: ${response.url()}`)
  })
  page.on('requestfailed', (request) => {
    // An aborted request is the page changing its mind, not a failure.
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`failed: ${request.url()} (${request.failure()?.errorText})`)
  })
  return problems
}

interface OpenOptions {
  /** Play the full first-visit intro instead of the short repeat-visit one. */
  firstVisit?: boolean
}

/** Opens a page with GitHub mocked and waits until the intro curtain has lifted. */
export async function open(page: Page, path: string, { firstVisit = false }: OpenOptions = {}): Promise<string[]> {
  const problems = watch(page)
  await mockGithub(page)
  if (!firstVisit) {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem('dh.intro.seen', '1')
      } catch {
        /* storage blocked: the long intro plays, which is still correct */
      }
    })
  }
  await page.goto(path)
  await introDone(page)
  return problems
}

/**
 * The preloader is a fixed curtain over the whole page. Playwright's "visible"
 * does not mean "not covered", so wait until whatever is on top at the middle
 * of the screen belongs to the page and not to the curtain.
 */
export async function introDone(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    return !!top && !!top.closest('#root') && !top.closest('[class~="z-[1000]"]')
  })
}

/** The ids of every section, in page order. */
export const SECTIONS = ['home', 'about', 'philosophy', 'skills', 'building', 'projects', 'github', 'presence', 'contact'] as const

/**
 * Scrolls a section to the top of the viewport. Not `scrollIntoViewIfNeeded`:
 * that waits for the element to hold still for two animation frames, and on a
 * CI runner WebGL is drawn in software, so under a 3D scene a frame can take
 * most of a second and the wait can outlast the test. The page's own scroll is
 * what the lazy loaders watch, so a plain `scrollIntoView` asks for the same
 * chunks.
 */
export async function scrollTo(page: Page, id: (typeof SECTIONS)[number]): Promise<void> {
  await page.evaluate((target) => document.getElementById(target)?.scrollIntoView({ block: 'start' }), id)
}
