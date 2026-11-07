# TorexSite

Personal brand site of Dilshodjon Haydarov (To-Rex), live at https://torexdev.uz on Netlify (repo `To-Rex/MySite`).
React 19 · Vite 7 · TypeScript strict · Tailwind 4 · three.js / R3F / drei · motion · lenis.
Everything 3D is procedural: there are no model or texture files anywhere.

## Commands

```bash
npm run dev        # dev server
npm run typecheck  # tsc -b --noEmit (app, tool configs and tests)
npm run lint       # eslint
npm test           # unit tests, ~4 s — source only
npm run build      # tsc + vite build + dist/_headers (CSP) + robots/sitemap rewrite
npm run test:dist  # tests on dist/ — needs the build
npm run test:e2e   # Playwright against dist/ with production headers, desktop + phone (~1 min)
npm run shots      # screenshots of every section into test-results/shots/ (not a test)
npm run verify     # all of the above in order; what CI runs
```

A change is done when `npm run verify` passes **and the build output has no warnings**. For a
small change, `typecheck && lint && test` is the fast loop; run the rest before calling it done.
After a visual change, run `npm run shots` and look at the pictures — it shims the device tier,
so they show what a desktop visitor sees (rule 11).

Tests live in `tests/unit`, `tests/dist`, `tests/e2e`. The load-bearing rules below are enforced
by `tests/unit/architecture.test.ts`; if one fails, fix the code, not the test. README → Testing.

## Find things without reading everything

- `graphify-out/GRAPH_REPORT.md` is the module map. For structure questions use the graph before
  opening files: `graphify query "<question>"`, `graphify explain "<symbol>"`,
  `graphify affected "<symbol>"`. Each costs ~1.5k tokens.
- After changing code run `graphify update .` (local AST, no LLM, a few seconds). The folder is
  gitignored; if it is missing the same command rebuilds it.
- `README.md` is 700 lines of design rationale for the 3D work. Do not read it whole. Read the
  section for what you are about to touch:

| Touching | README section |
| --- | --- |
| `creatures.ts`, `sdf.ts`, `skinMaterial.tsx`, `creatureRig.ts`, `HeroScene.tsx` | The hero creatures |
| `Companion.tsx`, `CompanionTurtle.tsx`, `useCreature.ts` | The scroll companion |
| `Spectacle.tsx`, `stage.ts`, `mascots.ts`, `lib/spectacle.ts` | The hero's easter egg |
| `Cameo.tsx`, `useCameoDirector.ts` | Cameos |
| `Valley.tsx`, `ValleyScene.tsx`, `valley*.ts(x)`, `lib/valley.ts` | The extinction cinematic |
| any `<Canvas>` | Canvases and the pointer · Parked canvases and the clock |
| layout, breakpoints | Responsive |
| `scripts/`, `netlify.toml`, `site.ts` | Deployment |
| `index.html` head, `Seo.tsx` | Deployment → Link previews |
| `ProjectDialog.tsx`, `MobileMenu.tsx`, `useFocusTrap.ts` | Overlays and the keyboard |
| `tests/`, CI | Testing |

## Layout

```
src/app          shell, provider order, section order
src/config       site identity (site.ts), section ids / nav
src/content      language-neutral data: projects, technologies, socials
src/i18n         Dictionary type + uz (default) / en / de / ru
src/sections     one file per page section
src/components   ui, layout, cursor, loader, seo, three (all 3D)
src/lib          module stores (pointer, spectacle, valley), helpers
scripts          post-build: CSP headers, robots/sitemap, site URL resolution
```

## Rules that are load-bearing

Each of these was a debugging round the first time. The README section explains why.

1. **Gates stay three-free.** `Companion.tsx`, `Valley.tsx`, `src/lib/*`, the sections and the
   app shell must not import `three` or `@react-three/*` at runtime (`import type` is fine).
   3D enters only through `lazy()` / dynamic `import()`. One static import moved the entry
   bundle from 136 kB to 372 kB.
2. **`sdf.ts`, `creatures.ts`, `mascots.ts` stay three-free** so the meshing worker does not
   bundle a second copy of three.
3. **Never pose from `state.clock`.** Canvases are parked with `frameloop="never"` and R3F
   resets or corrupts that clock. Accumulate clamped frame deltas (cap 0.25 s). The valley
   timeline is the one deliberate exception: it runs on a wall clock.
4. **Guard every value that feeds a transform with `finite()`.** One NaN makes three draw
   nothing, silently.
5. **Full-bleed canvases need `style={{ pointerEvents: 'none' }}` on the `<Canvas>` itself**;
   the wrapper's class is not enough. The universe canvas is the exception, its meshes take clicks.
6. **Creature geometry is cached per (kind, detail) and shared.** Take detail from
   `DETAIL_BY_TIER` in `creatureRig.ts`, and never dispose that geometry.
7. **Every UI string goes in all four locale files.** The `Dictionary` type makes a missing key
   a compile error; keep it that way.
8. **Content honesty.** No invented achievements, stats, clients or project details. Missing
   data stays empty and the UI shows its placeholder.
9. **CSS: write `backdrop-filter` unprefixed only.** Lightning CSS adds `-webkit-` itself, and a
   hand-written prefixed copy after it makes it drop the unprefixed one, which is the only one
   Chrome and Firefox read.
10. **New remote origins must be added to the CSP** in `scripts/generate-headers.mjs`
    (`connect-src` / `img-src`), or they are blocked in production only.
11. **Headless browsers are classified `low` tier** (coarse pointer, four cores), so bump mapping
    and shadows are off in them. Shim `matchMedia` and `hardwareConcurrency` before judging 3D
    visuals from a screenshot — `npm run shots` already does.
12. **`index.html`'s head and `<Seo>` must say the same thing.** Crawlers read only the static
    one. Change a tag in either and change the other; `tests/unit/seo.test.tsx` requires them equal.
13. **Anything that covers the page uses `useFocusTrap`**, with every element that must stay
    usable passed as a root. Never `inert` by hand.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
