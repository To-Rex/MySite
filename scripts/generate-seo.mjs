/**
 * Rewrites `dist/robots.txt` and `dist/sitemap.xml` to the URL this build is
 * actually being served from.
 *
 * Both ship from `public/` as plain static files, so they cannot read Vite's
 * env the way `site.ts` does. They are written with the production domain in
 * them — valid as they stand, and correct for a local build — and this pass
 * swaps in whatever `resolveSiteUrl` decides once the host is known.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANONICAL_URL, resolveSiteUrl } from './site-url.mjs'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const target = resolveSiteUrl()

if (target === CANONICAL_URL) {
  console.log(`[seo] serving as ${target} — robots.txt and sitemap.xml already match`)
} else {
  for (const name of ['robots.txt', 'sitemap.xml']) {
    const file = join(dist, name)
    if (!existsSync(file)) {
      console.warn(`[seo] ${name} is missing from dist — skipped`)
      continue
    }
    const before = readFileSync(file, 'utf8')
    const after = before.split(CANONICAL_URL).join(target)
    writeFileSync(file, after)
    console.log(`[seo] ${name}: ${(before.split(CANONICAL_URL).length - 1)} URLs → ${target}`)
  }
}
