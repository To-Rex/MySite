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
                  skinMaterial.tsx — procedural reptile hide + baked AO
                  sdf.ts / creatures.ts — procedural creature meshing (three-free)
                  creatures.worker.ts — runs that meshing off the main thread
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

### The hero creatures

The tyrannosaur ("To-Rex") and the turtles (from the GitHub avatar) are generated
in code — there are no model files to download or license.

**Shape.** Anatomy is authored in `creatures.ts` as ellipsoid masses plus tapering
tubes, and shapes flagged `negative` are carved back out (eye sockets, nostrils,
the mouth line, the seam around the shell). Those are *not* meshed as separate
shells, which would leave visible intersection creases; they are blended into one
signed distance field and `sdf.ts` extracts a single continuous surface from it
(surface nets). Vertex normals come from the field gradient, so shading is smooth
everywhere, and ambient occlusion is baked per vertex from the same field — that
is what makes a carved socket read as a recessed eye.

**Motion.** Each creature is skinned to a small procedurally built skeleton, which
lets the tail travel a wave and the head turn without the surface tearing. The
idle is composed from several periods (tail wave, breathing ribcage, head scan)
so it never visibly loops. Still one draw call per creature.

**Surface.** `skinMaterial.tsx` adds reptile hide on top of MeshPhysicalMaterial:
a procedural Worley scale/wrinkle height map, triplanar-sampled in bind space so
the pattern stays glued to the body while it animates, plus surface-gradient
(Mikkelsen) bump mapping — which needs neither UVs nor tangents, and the mesh has
neither.

Four things here are easy to get wrong, and each cost a debugging round:

- **Bump magnitude is not intuitive.** The height map spans 0..1 across a few
  pixels, so its screen-space gradient is enormous; useful values are ~0.03, not
  ~0.5. Too high and the normals scatter into speckle that erases every highlight.
- **Texture frequency must be set from on-screen size.** Aim for scales around
  6–10 px. Finer than that and the bump derivative aliases into noise.
- **`DataTexture` defaults to `NearestFilter` on _both_ filters.** Setting only
  `minFilter` leaves the pattern rendering as hard texel blocks.
- **Generation cost lands on the main thread.** A sin-based hash with tuple
  returns made the skin texture take ~2 s and visibly stalled the intro; an
  allocation-free integer hash brought it under 100 ms.

Field `spacing` and blend radius are likewise coupled: a blend much smaller than
the spacing cannot be resolved and joints look like hard creases again, while a
blend near the size of a real feature (a flipper, a toe) dissolves that feature.
Keep anatomy comfortably thicker than the blend.

Meshing itself costs several hundred milliseconds, so it runs in
`creatures.worker.ts`. `sdf.ts` and `creatures.ts` are deliberately three.js-free
so that worker stays ~11 kB instead of bundling a second copy of three; the main
thread only turns the returned typed arrays into a `BufferGeometry`. Results are
cached per (creature, quality tier) and shared by every instance, and the hero
simply renders nothing until its geometry arrives.

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
