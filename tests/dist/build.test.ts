import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveSiteUrl } from '../../scripts/site-url.mjs'

/**
 * What was actually built — the files a visitor's browser will be handed.
 *
 * Some failures only exist here. The source said `backdrop-filter`; the
 * minifier shipped only the prefixed copy. The source imported a scene lazily;
 * one stray import put three.js in the entry chunk anyway. Reading `src/` shows
 * neither. Run `npm run build` first.
 */

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')
const ASSETS = join(DIST, 'assets')
const read = (...path: string[]) => readFileSync(join(DIST, ...path), 'utf8')
const kB = (bytes: number) => Math.round(bytes / 100) / 10

let html = ''
let headers = ''
let assets: string[] = []
const site = resolveSiteUrl()

beforeAll(() => {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/ is missing — run `npm run build` before `npm run test:dist`')
  html = read('index.html')
  headers = read('_headers')
  assets = readdirSync(ASSETS)
})

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
const tags = (name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((match) => match[0])
const meta = (key: string) => tags('meta').find((tag) => attr(tag, 'property') === key || attr(tag, 'name') === key)

describe('index.html', () => {
  it('has the site URL baked in everywhere it was asked for', () => {
    expect(html).not.toMatch(/%VITE_[A-Z_]+%/)
    expect(tags('link').find((tag) => attr(tag, 'rel') === 'canonical')).toContain(`href="${site}/"`)
    expect(attr(meta('og:url')!, 'content')).toBe(`${site}/`)
  })

  it('points link previews at an image that is really there, at the size it claims', () => {
    const image = attr(meta('og:image')!, 'content')!
    expect(image).toBe(`${site}/og.png`)
    const png = readFileSync(join(DIST, 'og.png'))
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    // IHDR: width and height are the two big-endian words after the chunk header.
    expect(String(png.readUInt32BE(16))).toBe(attr(meta('og:image:width')!, 'content'))
    expect(String(png.readUInt32BE(20))).toBe(attr(meta('og:image:height')!, 'content'))
    // Telegram and WhatsApp skip preview images past a few hundred kB.
    expect(png.length).toBeLessThan(300_000)
  })

  it('ships structured data that parses', () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]!) as { '@type': string; url: string })
    expect(blocks.map((block) => block['@type']).sort()).toEqual(['Person', 'WebSite'])
    for (const block of blocks) expect(block.url).toBe(`${site}/`)
  })
})

describe('Content-Security-Policy', () => {
  const policy = () => headers.match(/Content-Security-Policy: (.*)/)![1]!
  const directive = (name: string) => policy().split('; ').find((part) => part.startsWith(`${name} `)) ?? ''

  it('pins the hash of every inline script the browser will run — and nothing else', () => {
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(([, attrs]) => !/\ssrc=/.test(attrs!) && !/type="application\/ld\+json"/.test(attrs!))
      .map(([, , body]) => `'sha256-${createHash('sha256').update(body!, 'utf8').digest('base64')}'`)
    expect(inline.length).toBeGreaterThan(0)
    const pinned = directive('script-src').split(' ').filter((token) => token.startsWith("'sha256-"))
    // A hash that is missing blocks the theme script and the page flashes the
    // wrong theme; a hash too many is a hole for something that is not ours.
    expect(pinned.sort()).toEqual(inline.sort())
  })

  it("never allows inline or eval'd script", () => {
    expect(directive('script-src')).not.toMatch(/unsafe-inline|unsafe-eval/)
    expect(directive('default-src')).toBe("default-src 'self'")
    expect(directive('object-src')).toBe("object-src 'none'")
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'")
  })

  it('allows exactly the remote origins the app talks to', () => {
    expect(directive('connect-src').split(' ').slice(1).sort()).toEqual(["'self'", 'https://api.github.com', 'https://github-contributions-api.jogruber.de'])
    expect(directive('img-src')).toContain('https://avatars.githubusercontent.com')
    // The meshing worker is a same-origin module.
    expect(directive('worker-src')).toContain("'self'")
  })

  it('caches hashed assets forever and the document never', () => {
    expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/)
    expect(headers).toMatch(/\/index\.html\n\s+Cache-Control: public, max-age=0, must-revalidate/)
  })
})

describe('bundle', () => {
  /** Chunks the document asks for, then every chunk those import statically. */
  const upFront = () => {
    const entry = [
      ...tags('script').map((tag) => attr(tag, 'src')),
      ...tags('link').filter((tag) => attr(tag, 'rel') === 'modulepreload').map((tag) => attr(tag, 'href')),
    ]
      .filter((src): src is string => !!src?.endsWith('.js'))
      .map((src) => src.replace(/^\/assets\//, ''))
    const seen = new Set(entry)
    const queue = [...entry]
    while (queue.length) {
      const code = read('assets', queue.pop()!)
      // `import … from"./x.js"` and bare `import"./x.js"` — not `import("./x.js")`.
      for (const match of code.matchAll(/(?:^|[;}\n])\s*(?:import|export)\s*(?:[^"'()]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g)) {
        if (!seen.has(match[1]!)) {
          seen.add(match[1]!)
          queue.push(match[1]!)
        }
      }
    }
    return [...seen]
  }

  it('loads no three.js before it is asked for', () => {
    const chunks = upFront()
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    expect(chunks.filter((name) => /^three-/.test(name))).toEqual([])
    for (const name of chunks) expect(read('assets', name), name).not.toContain('WebGLRenderer')
    // And it does exist, as its own chunk, for the scenes to pull in later.
    expect(assets.some((name) => /^three-.*\.js$/.test(name))).toBe(true)
  })

  it('stays inside its size budget', () => {
    const chunks = upFront()
    const size = (name: string) => statSync(join(ASSETS, name)).size
    const entry = chunks.find((name) => name.startsWith('index-'))!
    // Tripwires, not targets. The app chunk is ~145 kB; the one time a scene
    // was imported statically it became 372 kB. Raise these on purpose, with a
    // reason, or not at all.
    expect(kB(size(entry)), 'app entry chunk (kB)').toBeLessThan(200)
    expect(kB(chunks.reduce((sum, name) => sum + size(name), 0)), 'all JS loaded up front (kB)').toBeLessThan(560)
  })

  it('keeps the meshing worker small and renderer-free', () => {
    const worker = assets.find((name) => name.startsWith('creatures.worker-'))!
    expect(worker).toBeDefined()
    expect(kB(statSync(join(ASSETS, worker)).size)).toBeLessThan(60)
    expect(read('assets', worker)).not.toContain('WebGLRenderer')
  })
})

describe('stylesheet', () => {
  const css = () => read('assets', assets.find((name) => /^index-.*\.css$/.test(name))!)
  const rule = (selector: string) => css().match(new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? ''

  it('ships backdrop-filter in the form every browser reads', () => {
    // Chrome and Firefox ignore the prefixed property; Safari before 18 needs it.
    for (const selector of ['.glass', '.universe-label']) {
      expect(rule(selector), selector).toMatch(/(^|;)backdrop-filter:blur/)
      expect(rule(selector), selector).toMatch(/-webkit-backdrop-filter:blur/)
    }
  })

  it('kept the whole of a rule that was once cut in half', () => {
    expect(rule('.universe-label')).toContain('white-space:nowrap')
    expect(rule('.universe-label')).toContain('cursor:pointer')
    expect(rule('.universe-label')).toContain('transition:')
  })
})

describe('robots.txt and sitemap.xml', () => {
  it('advertise the address this build is served from', () => {
    expect(read('robots.txt')).toContain(`Sitemap: ${site}/sitemap.xml`)
    const sitemap = read('sitemap.xml')
    expect(sitemap).toContain(`<loc>${site}/</loc>`)
    for (const lang of ['uz', 'en', 'de', 'ru']) expect(sitemap).toContain(`href="${site}/?lang=${lang}"`)
  })
})

describe('Google Search Console', () => {
  // Google fetches /<token>.html and expects exactly this line back. A rename,
  // a stray newline or a build step that stops copying public/ unverifies
  // the property, silently.
  it('serves the ownership proof at the root, byte for byte', () => {
    const token = 'google65ed419aea3368d9'
    expect(read(`${token}.html`)).toBe(`google-site-verification: ${token}.html`)
  })
})
