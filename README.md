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
                  Companion.tsx — gate for the scroll companion (three-free)
                  CompanionTurtle.tsx — the turtle that follows the reader
                  creatureRig.ts / creatureFittings.tsx — shared skeleton, eyes, teeth
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
lets the body deform without the surface tearing. Still one draw call per creature.

The tyrannosaur walks. A stride clock drives everything at once so the parts stay
in step: hips swing and knees fold half a cycle apart, ankles keep the sole level
then push off, the body rises twice per stride and rolls toward the carrying leg,
the tail counter-swings against the hips, and the head nods on the same beat. The
gait eases in over the first ~1.6 s so the creature does not snap into mid-stride
the moment its geometry arrives from the worker.

Layered on top: a travelling tail wave, a breathing ribcage, a slow horizon scan
and small-arm twitches, all on unrelated periods so nothing visibly loops. Every
5.5 s one *accent* fires — a longer head turn or a heavier tail swish. Those
alternate rather than being chosen at random: pure noise happened to leave head
turns unused for the first half-minute, which a visitor would simply never see.
Noise still picks direction, strength, and the occasional slot where both fire.

Bones sit unrotated in bind pose, so their local axes are the creature's: for a
downward-pointing leg bone, +Z swings it forward and −Z folds the knee back the
way a digitigrade leg actually folds. Worth remembering before editing `poseLeg`.

**Eyes and teeth.** Neither can be part of the SDF: sockets and the gape are
carved *after* the union, so anything sitting in them gets carved away too. Both
are separate meshes portalled onto the head bone, which makes them track every
head turn for free — eyeballs as small glossy spheres, teeth as a single
instanced cone. Their positions ride along in the creature payload, already
normalised, so the anatomy and the fittings can never drift apart.

**Surface.** `skinMaterial.tsx` adds reptile hide on top of MeshPhysicalMaterial:
a procedural Worley scale/wrinkle height map, triplanar-sampled in bind space so
the pattern stays glued to the body while it animates, plus surface-gradient
(Mikkelsen) bump mapping — which needs neither UVs nor tangents, and the mesh has
neither.

Colour comes from two absolute hides per species — a dark dorsal and a pale
ventral, blended by height so the animals are countershaded the way real ones
are. They are absolute colours rather than a tint multiplied onto one base
colour: a multiplier can only ever darken, so the first version came out with a
belly *darker* than the back, which is backwards. Values are lifted in the dark
theme, since a genuinely dark olive vanishes against a near-black page, and the
turtle is pushed greener with a paler plastron so the two species do not read as
the same animal at two sizes.

On top of that: low-frequency blotching so the hide is never one flat colour, and
a `plateMix` that chooses between the texture's fine scale channel and its coarse
plate channel — which is how one texture serves both tyrannosaur hide and a
turtle's shell scutes.

Four things here are easy to get wrong, and each cost a debugging round:

- **Bump magnitude is not intuitive.** The height map spans 0..1 across a few
  pixels, so its screen-space gradient is enormous; useful values are ~0.03, not
  ~0.5. At 0.15 the hide already turns into a harsh crust that breaks up every
  highlight and flattens the form.
- **The bump is off on `low`-tier devices — including headless browsers.**
  Headless Chrome reports `pointer: coarse` and four cores, so `useDeviceTier`
  classifies it as low and passes `bump = 0`. Screenshot tests therefore show a
  surface no real desktop visitor sees. `scratchpad/verify/desktop.mjs` shims
  `matchMedia` and `hardwareConcurrency` to make the test browser representative;
  without that shim, tuning the bump from screenshots is meaningless.
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

### The scroll companion

Past the hero, one turtle follows the reader down the page. It cannot live in
the hero scene — that canvas scrolls away with its section — so it gets its own
fixed, pointer-transparent canvas. Leaving the hero fades the layer back out
rather than unmounting it: tearing a WebGL context down and rebuilding it on
every scroll reversal costs far more than one idle canvas.

It reuses the hero's cached geometry and rigs its own skeleton, so it adds no
meshing work. That is why `DETAIL_BY_TIER` lives in `creatureRig.ts` and is
shared: geometry is cached per (creature, detail), and asking for a different
detail would quietly mesh the same animal twice.

Three things here are load-bearing:

- **`Companion.tsx` must stay free of three.js imports.** It decides only
  *whether* the companion exists; the turtle is a `lazy()` chunk behind it.
  Importing `CompanionTurtle` straight from the app shell took the entry bundle
  from 136 kB to 372 kB, because a static import of the 3D module pulls the whole
  renderer in with it.
- **Scroll is read from `window.scrollY` inside the frame loop**, not through a
  motion value. The first version fed `useScroll`/`useVelocity` into the damping
  chain, and on the first frames those produced a NaN. A single NaN reaching a
  rotation invalidates the object's matrix and three then draws *nothing* — no
  warning, no error, while the object still reports `visible: true` and a sane
  position. Every value that feeds a transform now goes through a `finite()`
  guard; keep it that way.
- **Where it swims is a legibility decision.** On a wide screen it rides the
  right margin — the column is capped at 84rem, so the turtle is over empty page
  and only clips the ends of lines. A phone has no margin to hide in, so it drops
  into the bottom corner instead. Its size is a fraction of the *smaller* of
  viewport width and height rather than a fixed world scale, otherwise the same
  turtle is a thumbnail on an ultrawide monitor and covers half a phone screen.

**Staying in frame.** The lane is not a position, it is a distance in from a
limit recomputed every frame, so the body can never be half off the edge. The
limit comes from the geometry's bounding *sphere* — `centre.length() + radius`,
which bounds the body at any orientation, mid-somersault included — divided by
half the viewport, and it shrinks again by the perspective factor whenever a
stunt pushes the turtle toward the camera, since that magnifies both the body and
its distance from the centre. Screen positions and lane targets are both clamped
to it. The first version placed the turtle at a fixed fraction of the viewport
and hung a third of its body off the right edge on a narrow window.

**Stunts.** The turtle answers what the reader just did, in its own axes — the
head sits at +X and the flippers at ±Z, so X rolls it along its length, Z
somersaults it nose over tail and Y pirouettes it flat:

| Trigger | Stunt |
| --- | --- |
| Hurrying down the page | a full barrel roll, alternating with a dart at the camera |
| A really hard flick of the wheel | a corkscrew: two rolls and a dive at the camera |
| Hurrying back up | a full somersault |
| Crossing into a new quarter of the page | a flat pirouette |
| Reaching the bottom of the page | a tumble — roll and somersault at once, once per visit |
| Nobody has scrolled for 7 s | turns to the reader and waves a flipper |

Two rules keep this from becoming noise. A crossing is *remembered* rather than
acted on at once: a hurried scroll crosses a quarter too, and the damped speed
needs a moment before it can say which this is, so the pirouette waits half a
second and any stunt that fires meanwhile consumes it. And the greeting keeps a
long cooldown of its own, separate from the 2.5 s between scroll stunts — sharing
one cooldown meant a wave could leave a real scroll unanswered for thirteen
seconds. If the reader moves while it is waving, the run is rewound so it lands
on its own ramp-down within 0.3 s instead of the pose snapping away; that rewind
must happen *once* per run, since re-cutting an already-cut run every frame
leaves it stuck just short of finished, holding a tenth of the pose.

Velocities divide by the true frame time while the damping uses a capped one.
They looked interchangeable and are not: a capped clock makes a damped signal lag
in proportion to how slow the device is, so on a 15 fps phone the turtle noticed
a hurried scroll only after the reader had stopped.

Its cubemap is baked at 64px against the hero's 128–256: baking one is a visible
main-thread stall, and at this size it feeds reflections a few pixels wide. Night
lighting is also brighter than the hero's, because a small creature over a
near-black page reads as a silhouette under the hero's key light.

`prefers-reduced-motion` removes it entirely — a creature that chases the reader
is exactly the motion that preference asks us to drop.

### The hero's easter egg

Double-click the name and it is handed to the tyrannosaur. Twenty seconds later
the page is exactly as it was:

| Act | What happens |
| --- | --- |
| `summon` | The letters fall and one of six animals condenses where the words were |
| `stalk` | It sees what is behind it; the tyrannosaur turns onto it and drops its head |
| `chase` | It bolts, jinking and bounding; the tyrannosaur runs it down, and the stage shakes under the strides |
| `catch` | The lunge, the snap, and a shake with the animal in its jaws |
| `swallow` | A head-toss, and a lump travelling down the throat |
| `turn` | It turns right around and presents its back to the room |
| `drop` | It squats, hips down and tail lifted clear, and what comes out lands |
| `leave` | It turns back to its usual heading and walks off the stage |
| `grow` | A tree rises out of what it left |
| `ripen` | One fruit swells and colours |
| `fall` | The fruit drops |
| `crack` | It splits, and the name comes out of it |
| `return` | The tyrannosaur walks back to exactly where it started |

The animals are the snake, elephant, gopher, crab, swift and camel behind the
languages in this stack, and never the same one twice in a row.
`prefers-reduced-motion` disables the whole thing, and so does a browser without
WebGL.

**The animals** are authored in `mascots.ts` with the same primitives as the
brand creatures, and deliberately at the same *raw* scale — roughly four units
nose to tail. Field spacing and fillet radius in `creatures.ts` are absolute
numbers, so an animal drawn at half that size gets half the detail budget: legs
and beaks thinner than the blend radius dissolve into the body. Every radius in
that file stays above ~0.1 for the same reason. Nothing is meshed until an animal
is actually summoned, so six extra creatures cost a normal visit nothing.

**The two halves of the episode live in different files** — the tyrannosaur is
animated in `HeroScene`, the hunt is staged in `Spectacle` — and they talk
through `stage.ts` as *numbers*, not poses: how much to crouch, run, lunge,
thrash and swallow, and where to walk. The idle animation stays the single owner
of the skeleton, which is what lets a hunt blend in and out of a walk cycle
instead of fighting it for the same bones. The lump travelling down the throat is
the breathing ribcage's trick again — a narrow bulge scaling each neck bone in
turn, its centre sliding from jaw to chest.

**The stride is counted, not derived from the clock.** A hunt shortens it and
lengthens the reach, and `t / STRIDE` with a changing `STRIDE` jumps the legs
mid-step. The lunge is a step *forward*, so it follows the creature's current
heading rather than +x — it turns right around to chase, and +x is behind it then.

**Standing the animal exactly where the words were** means crossing from DOM to
3D: the headline's `getBoundingClientRect` becomes normalised device coordinates
against the canvas, is unprojected, and is pushed along that ray until it crosses
the plane the arrangement sits on. Everything downstream is anchored to that
point, so the tree grows and the fruit splits where the name belongs.

**The letters reuse the reveal they already have.** `SplitText` runs backwards to
drop them, then forwards — slower, and with a longer stagger — to grow them out
of the split fruit, so the easter egg adds no second text animation to keep in
sync with the first.

**The drop is its own act, after the turn is finished.** The first cut let the
creature start walking away while the dropping was still being placed, so the one
thing on stage nobody could see was the thing the rest of the episode grows out
of. Now it completes its turn, stands still with its back quarter to the room,
squats — hips down, tail lifted clear, with the tremble of an animal straining —
and only then does anything come out. Lifting the tail is the *negative*
direction: bones sit unrotated in bind pose, so a tail joint's local +x still
points forward, and rotating it about +z drives the tip down.

One rule when editing the script: place things on a flag, not inside a slice of
an act. The dropping was first positioned during the opening 6% of its act, a
window 84 ms wide — missed outright on a device drawing 3 fps, and it then fell
from the origin, which is the middle of the tyrannosaur. The tree grew out of its
back.

### Cameos

Every so often on the way down the page, something crosses it: a tyrannosaur
running one of the six animals down and not stopping for it, or three turtles
gliding past in formation. They ride the companion's canvas — the only one that
exists the whole way down — and alternate, with at least sixteen seconds between
them.

They fire on the reader passing a third of the page — or simply covering a lot
of ground since the last one, because on a short page two thirds can sit inside
one flick of the wheel and the cameos go quiet. Either way it is distance, not a
timer, so a cameo always arrives as part of getting somewhere and never while
someone sits still reading one paragraph. The director also keeps a watchdog on
whatever is on stage: a cameo is supposed to clear itself at the end of its run,
and without a backstop one that cannot — waiting on a mesh, or parked off-screen
mid-crossing — silently ends every cameo for the rest of the visit. Nothing is meshed until one is due, and the chase
reuses the tyrannosaur the hero has already built: geometry is cached per
(creature, detail) and shared between every instance, so a cameo costs two more
skinned meshes for four seconds rather than two more meshing runs. The chase is
skipped on `low`-tier devices, which get the turtles and nothing heavier.

`poseLeg`, `animateDinoRun` and `animateMascot` live in `creatureRig.ts` because
three separate places now drive the same skeletons — the hero, the easter egg and
the cameos. The hero's tyrannosaur keeps its own much richer idle; the cameo
animator is deliberately compact, because the creature is on screen for three
seconds and the only thing that has to read is *running*.

### Parked canvases and the clock

Every 3D scene here stops rendering once it scrolls off screen — that is what
`frameloop="never"` does, and it is most of why three canvases cost so little.
The catch is that R3F treats `state.clock` as its own scratch space while that
prop is in play:

- flipping it resets `elapsedTime` to zero — on the way out **and** on the way back;
- a frame that slips through while parked sets `elapsedTime` to the raw
  `requestAnimationFrame` timestamp, which is in *milliseconds*, so a number that
  should read ~40 arrives as ~40000.

So nothing under `three/` may pose anything from `state.clock`. Each scene counts
its own time forward instead, in clamped steps, and parking it then pauses that
time rather than rewinding it.

Left alone this is not subtle. The hero's turntable drift is a target that grows
with time, so a millisecond timestamp sent it thousands of radians out and the
reset yanked it back: returning to the top of the page spun the tyrannosaur
through a dozen turns in about a second — measured at 12.87 turns of travel, with
one frame of 21 radians, against 0.08 turns and 0.067 rad after the fix. The
turtles snapped around their orbits at the same moment, the tech sphere's wire
cage jumped to a fresh angle, and the companion's stunt deadlines — all absolute
times — were stranded in the future, so it quietly stopped doing anything at all.

The cap on each step is 0.25 s, and that looseness is deliberate: it only has to
reject the nonsense above. Clamping to a frame budget like 1/30 looks tidier and
runs the whole hero at a third speed on a device drawing 9 fps.

### Performance

- The entire three.js stack loads lazily; the initial JS payload is React + Motion + app code only (~140 kB, 42 kB gzipped).
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
