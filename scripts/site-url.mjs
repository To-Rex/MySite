/**
 * Where this build thinks it lives.
 *
 * Three consumers have to agree or the deployed site contradicts itself: the
 * canonical and og:url tags (`src/config/site.ts`, fed through Vite's `define`),
 * `robots.txt` and `sitemap.xml`. They used to be three separate hard-coded
 * copies of one domain, so a deploy to any other host advertised a URL it was
 * not being served from.
 *
 * Order of preference:
 *  1. `VITE_SITE_URL` — set it explicitly and nothing else is consulted.
 *  2. `URL` — Netlify sets this to the site's primary address at build time,
 *     which is the custom domain once one is attached and the `.netlify.app`
 *     address until then. That is exactly the fallback we want.
 *  3. `DEPLOY_PRIME_URL` — branch and preview deploys.
 *  4. The intended production domain, for local builds.
 */

/** The domain the site is meant to end up on, once DNS points at the host. */
export const CANONICAL_URL = 'https://torexdev.uz'

const clean = (value) => value.trim().replace(/\/+$/, '')

export function resolveSiteUrl(env = process.env) {
  const candidate =
    env.VITE_SITE_URL || env.URL || env.DEPLOY_PRIME_URL || CANONICAL_URL
  const url = clean(String(candidate))
  // A malformed override would otherwise end up baked into every canonical tag.
  try {
    return clean(new URL(url).toString())
  } catch {
    console.warn(`[site-url] "${url}" is not a URL — falling back to ${CANONICAL_URL}`)
    return CANONICAL_URL
  }
}
