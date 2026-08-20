# Dilshodjon Haydarov — Personal Digital Brand

> **Men g‘oyalarni haqiqiy mahsulotlarga aylantiraman.**
> Developer · Creator · Builder

A premium, immersive personal brand website for **Dilshodjon Haydarov** ([@To-Rex](https://github.com/To-Rex)) built with React + Vite + TypeScript, React Three Fiber and Motion.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | React 19 + Vite 7 + TypeScript (strict) |
| Styling | Tailwind CSS 4 (design tokens in `src/styles/globals.css`) |
| 3D | three.js + @react-three/fiber + @react-three/drei (lazy-loaded) |
| Animation | motion (Motion One / Framer Motion successor) |
| Smooth scroll | lenis |
| Fonts | Manrope Variable + JetBrains Mono Variable (self-hosted) |

## Commands

```bash
npm install       # install dependencies
npm run dev       # dev server
npm run build     # typecheck + production build (dist/)
npm run preview   # serve the production build
npm run lint      # eslint
npm run typecheck # tsc only
```

## Architecture

```
src/
  app/            App shell (providers, section order), intro context
  config/         site identity (site.ts), section ids/nav (sections.ts)
  content/        language-neutral data: projects, technologies, socials, "now" areas
  i18n/           types (Dictionary contract), 4 locale files, provider, context
  theme/          dark/light ThemeProvider (View Transitions circular reveal)
  components/
    ui/           Button, SplitText, Reveal, Magnetic, TiltCard, Marquee, icons…
    layout/       Navigation, MobileMenu, Footer, LanguageSwitcher, ThemeToggle
    three/        HeroScene, UniverseScene, ThemedEnvironment (all lazy)
    cursor/       custom cursor (desktop only)
    loader/       cinematic preloader
    seo/          localized meta / OG / hreflang / JSON-LD
  features/
    github/       live GitHub data (API + hook + contribution graph)
  sections/       Hero, About, Philosophy, TechUniverse, Building, Projects, GithubActivity, Presence, Contact
  hooks/, lib/    shared utilities (media queries, device tier, pointer store…)
```

### Languages (uz default · en · de · ru)

Every UI string lives in `src/i18n/locales/*.ts` and must satisfy the `Dictionary` type — adding a key without translating it in all four files is a **compile error**. The choice persists in `localStorage` (`dh.lang`) and can be forced with `?lang=uz|en|de|ru`.

### Themes

Dark is primary; light is a dedicated warm-white theme (not an inversion). All colors are CSS custom properties in `globals.css`. Selection persists (`dh.theme`), respects `prefers-color-scheme` on first visit, and can be forced with `?theme=dark|light` (useful for OG screenshots). The 3D scenes re-light per theme.

### Adding a real project

1. `src/content/projects.ts` — fill `technologies`, `status`, `year`, `links.github/demo`, and optionally `media.image`.
2. `src/i18n/locales/*.ts` → `projects.items[<id>]` — add `tagline`/`description` in all four languages.
   Empty descriptions render an honest "details coming soon" note — nothing is invented.
3. New project id? Add it to `ProjectId` in `src/i18n/types.ts` — the compiler then walks you through every file that needs copy.

### Performance

- The entire three.js stack loads lazily; the initial JS payload is React + Motion + app code only.
- Scenes render only while on screen (`frameloop="never"` off-screen), DPR adapts via `PerformanceMonitor`, and a device-tier estimate (`useDeviceTier`) scales geometry/particles; WebGL-less browsers get a designed 2D fallback.
- `prefers-reduced-motion` disables the preloader, parallax, marquees, sparkles and custom cursor.

## Deployment

- Set `VITE_SITE_URL` (see `.env.example`) to the production origin for canonical/OG/hreflang tags.
- Update the hard-coded domain in `public/robots.txt` and `public/sitemap.xml` if it isn't `https://torexdev.uz`.
- Static output — any static host works (`dist/`).

### Netlify

`netlify.toml` holds the build config; response headers are generated into `dist/_headers`
by `scripts/generate-headers.mjs` on every build (part of `npm run build`).

That file ships a strict Content-Security-Policy. `script-src` deliberately omits
`'unsafe-inline'` and instead pins the SHA-256 of the inline pre-paint theme script,
which is recomputed from the built HTML each time — so it can never go stale.

**"Powered by Netlify" badge.** Netlify enables this badge by default on Free-plan
projects created on or after 19 August 2026, injecting it from their edge servers.
Turn it off permanently in the dashboard: **Project configuration → General →
Powered by Netlify badge → off** (takes effect on the next request, no redeploy).
As a second layer, the CSP above also stops the injected inline script from running —
[documented behaviour](https://docs.netlify.com/manage/projects/powered-by-netlify-badge/),
not a workaround.

If you ever need to relax the policy, edit the directive list in
`scripts/generate-headers.mjs`; new third-party origins must be added to
`connect-src` / `img-src` explicitly.

## Content honesty

Per the brand brief: no invented achievements, stats, or clients. Missing data renders as clean placeholders driven by the data model, ready to be filled with real information.
