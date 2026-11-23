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
npm install       # install dependencies (`npm ci` for a lockfile-exact install)
npm run dev       # dev server
npm run build     # typecheck + production build (dist/)
npm run preview   # serve the production build
npm run lint      # eslint
npm run typecheck # tsc only

npm test          # unit tests — reads the source, takes a few seconds
npm run test:dist # tests on the build output — run `npm run build` first
npm run test:e2e  # browser tests against dist/, on a desktop and a phone
npm run shots     # a screenshot of every section into test-results/shots/
npm run verify    # everything above, in order — the same thing CI runs
```

Node 22 (`.nvmrc`), which is also what Netlify and CI build with. See [Testing](#testing).

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
    layout/       Navigation, MobileMenu, Footer, LanguageSwitcher, ThemeToggle,
                  ReadingTrail (the prints along the top), ScrollSky (the time of day)
    three/        HeroScene, UniverseScene, ThemedEnvironment (all lazy)
                  universeFlight.ts — the camera's flight through the universe (three-free)
                  EvolutionScene.tsx + evo*.ts — the long walk: its script, land, air, grass,
                  figures, rig, cast, cave, city, studio and lens
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
    github/       live GitHub data (API + hook + contribution graph, which draws in as a wave)
  sections/       Hero, Evolution (the gate of the long walk), About, Philosophy, TechUniverse, Building,
                  Projects, GithubActivity, Presence, Contact
  hooks/, lib/    shared utilities (media queries, device tier, pointer store, scroll curves…)
```

### Languages (oz default · uz · en · de · ru)

Every UI string lives in `src/i18n/locales/*.ts` and must satisfy the `Dictionary` type — adding a key without translating it in the four written files (`uz`, `en`, `de`, `ru`) is a **compile error**. A choice made on the switcher persists in `localStorage` (`dh.lang.choice`); a language the page merely resolved — from `?lang=`, the browser or the default — is not stored, so a changed default reaches everyone who never chose. Any language can be forced with `?lang=oz|uz|en|de|ru`.

`oz`, the default, is Uzbek in the new 28-letter Latin alphabet (A B D E F G Ğ H I J K L M N O Ö P Q R S Ş Ç T U V X Y Z), shown as **ÖZ** in the switcher; `uz` is the 1995 alphabet, kept for readers who prefer it, and a browser that asks for Uzbek in any script gets `oz`. It is not written by hand: `src/i18n/newLatin.ts` respells `uz` letter for letter — Oʻ→Ö, Gʻ→Ğ, Sh→Ş, Ch→Ç, and nothing else changes — so editing `uz.ts` updates both. Two things to know when writing Uzbek copy:

- A foreign word that must keep its own spelling (a product name, an English term used as-is) goes in `LOANWORDS` in `newLatin.ts`; language names are already exempt. `tests/unit/new-latin.test.ts` fails on any `sh`, `ch`, `oʻ` or `gʻ` left in `oz`, which is how an unlisted loanword shows up.
- Intl has no data for the new alphabet. `oz` uses the tag `uz-Latn-UZ-x-yangi`, which Intl formats as `uz-Latn-UZ` ("kecha", "oʻtgan oy"), and `respell()` fixes that output wherever it is shown: `formatRelative`, `formatCompact`, the contribution graph. A new `Intl` call that shows text needs the same wrapper.

Search engines know Uzbek Latin as one language, so there is one `uz-Latn` hreflang and sitemap entry, pointing at the default (`?lang=oz`); `uz` has none of its own, and both share the `og:locale` `uz_UZ`. The static head in `index.html` is written in `oz`.

**A change of language is shown letter by letter.** The state changes at once — the dictionary, `<html lang>`, the stored choice, the head — and then every string on screen turns into its translation over the next second: a front runs through each from its first letter to its last, top of the screen first; a letter the front has reached is some other letter of the language it is landing in for a moment, lit in the accent, and then it is the new one. Between the two Uzbek alphabets nothing is in the air: the text holds still and only the four spellings that differ turn over as the front passes, each in one go — "sh" is "ş", never "şh". What makes that work, and what to know before touching it:

- **React is not asked, and cannot tell.** By the time `letterMorph.ts` runs, React has put the new text in the page. In a layout effect — after the commit, before the paint — the old text is written back into the same text nodes, walked to the new text, and the last write is exactly what React wrote. React never reads the page back. If it writes to a node again first, with something newer, the next step finds a value it did not put there and lets go of that node; the same check is why a node is never given back after it was let go of. `tests/e2e/language.spec.ts` compares the page after a change, word for word, with a fresh visit in that language.
- **Only text nodes that survive the change can be walked**, so a list whose rows are keyed by their own words is replaced, not rewritten, and just appears. Key translated rows by position (`About`, `Philosophy` and the GitHub stats are).
- **A heading is told what to say instead.** `SplitText` sets every word in an element of its own, so a heading and its translation are different elements and each step between them a different number again: there is no text node to write into. It is a *writer* (`useWriter.ts`): once React has written the new text, and before the paint, it looks at how that lies, goes back to showing the old, and is then handed each step by the same clock as everything else and renders it at once (`flushSync`, so the lit letters can be found in what React has just written). Its words and letters are keyed by position, not by what they say — a word is the one in its place, so nothing is made again and nothing rises out of its mask a second time; what a translation adds to a heading already risen is simply there. `aria-label` is the new text from the first moment. A heading still under its masks, or under the menu, is not walked anywhere: it is given its text.
- **A heading is walked word against word** (`planMorphByWord`), where plain text is walked letter against letter. Each word turns into the word in its place and the space between two words stays a space, because a letter that reached across one would be two words fused into one too long for its line. The words a translation has more of come at the end, when the front gets there. The words it has fewer of do not wait: they go as the words before them grow, a letter for a letter, so the text is never longer than it was. (Two texts that share fewer than two words — "Technology universe", "Technologie-Universum" — are walked the plain way: a space turning into a letter is exactly that change.) And the letters in the air are, where the text has any, about as wide as the ones landing.
- **Its lines are not left to break themselves on the way.** The letters passing through are of every width; left to fall, a line a hair under full broke and mended from one frame to the next, and everything below the heading went up and down with it — three times in a second, in the first cut. So while a heading changes it does not wrap at all (`white-space: nowrap`) and is told where its lines break. Both layouts are known — the new one was on the page for a moment, unpainted — and each break is moved once, as the front passes (`linesOnTheWay`): a word drops to a line of its own when the front reaches it and comes up to the line before it once it has landed; a break that goes is paired with the nearest that comes and the two happen together, so the number of lines only moves towards what it will be. That rule knows nothing of widths, so each step is measured once it is on the page and mended before it is painted: a word that was going to drop anyway is hurried off a line that has outgrown its place, and a word that came up to a line with no room for it yet is held back until its two lines have landed — the one case in which a heading takes a line more on the way than it had or will have, and it is only taken where the words would otherwise run a word's width past their place (in a narrow window, the contact heading on its way to Russian). What is left elsewhere is a line standing a few letters past its place for a few frames, where the alternative was the whole page below it moving twice. The first and last steps lie exactly as the text does by itself, so nothing jumps when the heading is taken hold of or let go.
- **The two strings are aligned by the base of each letter** (`morph.ts`): "ş" and "s" are one letter changing its marks, which is what pairs "sh → ş" as s → ş with h going, and not s → ?, h → ş. Two strings within six edits for every ten letters are aligned that way — the Uzbek alphabets always are, a digraph costs one edit for two letters — and anything further apart (a sentence and its translation) is replaced position by position, holding whatever is the same at either end or in the same place. A letter that goes and a letter that comes are timed to the same instant, so a string only ever gets longer or only ever shorter: it does not breathe.
- **Half-changed text is not for reading.** Nothing inside an `aria-live` region, a status, `.sr-only`, a form control, or anything `inert` (the page under an open menu) is ever walked — it is simply replaced — and the body is `aria-busy` while anything is. Opt anything else out with `data-no-morph`; the marquee is, because each width it passed through would be measured as a new row.
- **It is capped.** Text on screen and a third of a screen either side, at most 220 nodes and 12,000 letters, rewritten at most thirty times a second. Everything else is replaced at once. On the build that ships, the click that changes the language takes about 4 ms longer than it did, and the frames after it stay at 60 a second (four times throttled: about 30 ms longer, same frames).
- **The lit letters are a CSS highlight** — ranges over the text, no elements added — and its rule is added by `letterMorph.ts` at run time, not written in the stylesheet: the CSS optimiser does not know `::highlight()` and warns, and the build has to stay free of warnings. A browser without highlights still gets the change, unlit.
- **One transition, never two.** The page used to dim to a third over a change of language. It still does where it cannot do this (no `matchMedia`), but never together with it. With reduced motion there is neither: the dim was cut to nothing by the global reduced-motion rule and showed as a flash, so the text is simply the new text. `<html data-lang-morph>` is set for as long as a change is on its way.

### Themes

Dark is primary; light is a dedicated warm-white theme (not an inversion). All colors are CSS custom properties in `globals.css`. Selection persists (`dh.theme`), respects `prefers-color-scheme` on first visit, and can be forced with `?theme=dark|light` (useful for OG screenshots). The 3D scenes re-light per theme.

### Adding a real project

1. `src/content/projects.ts` — fill `technologies`, `status`, `year`, `links.github/demo`, and optionally `media.image`.
2. `src/i18n/locales/*.ts` → `projects.items[<id>]` — add `tagline`/`description` in `uz`, `en`, `de` and `ru` (`oz` follows `uz`).
   Empty descriptions render an honest "details coming soon" note — nothing is invented.
3. New project id? Add it to `ProjectId` in `src/i18n/types.ts` — the compiler then walks you through every file that needs copy.
4. A description goes into all the written languages or none. The compiler cannot see an empty
   string, so `npm test` does: a project described in English and still "coming soon" in
   Uzbek fails it.

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
  surface no real desktop visitor sees. `npm run shots` (`tests/e2e/shots.spec.ts`)
  shims `matchMedia` and `hardwareConcurrency` to make the test browser
  representative; without that shim, tuning the bump from screenshots is meaningless.
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
| Settling into a steady scroll | a swoop: a long dive and climb back through |
| Crossing into a new quarter of the page | a flat pirouette, or a banked figure of eight |
| Reaching the bottom of the page | a tumble — roll and somersault at once, once per visit |
| Nobody has scrolled for 7 s | turns to the reader and waves a flipper |
| Nobody has scrolled for 15 s | comes up to the glass and cocks its head at them |

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

**Being there before it is wanted.** Building the canvas, baking its cubemap,
rigging the mesh and compiling the skin shader all have to happen before anything
can be drawn, and the first version started all of it at the line where the
turtle was supposed to fade in. So it arrived late — and a reader who flicks the
wheel hard crosses the wake line and the show line inside one frame, which is the
slowest possible moment to begin. The chunk is now fetched a second after load
and the canvas built a second after that, parked with `frameloop="never"` until
it is wanted; crossing the line then costs a frameloop flip and the opacity
transition. Measured in a software renderer, with nobody having scrolled at all:
canvas at 4 s, turtle rigged at 7 s.

**And the reason it sometimes never arrived at all.** The meshing worker's
`onerror` marked it dead without settling the requests it was already carrying.
Those promises never resolved, so whatever was waiting on that geometry — most
visibly the companion, which asks for its turtle last — simply never appeared,
with nothing in the console to explain it. A worker that dies now hands its queue
back to the main thread, and every request carries a four-second patience for the
other failure mode: a reply that never comes.

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

Every so often on the way down the page, something crosses it. Three of them,
taken in turn so the same thing never happens twice running:

| Cameo | What crosses |
| --- | --- |
| `chase` | A tyrannosaur running one of the six animals down, and not stopping for it |
| `sky` | Three pterosaurs crossing above the reading, gliding and flapping |
| `flock` | Three turtles gliding past in formation, low |

They ride the companion's canvas — the only one that exists the whole way down —
with at least sixteen seconds between them.

The pterosaur is authored in `mascots.ts` alongside the language mascots but
deliberately left out of `MASCOT_KINDS`: the easter egg picks from that list, and
a Jurassic flyer has nothing to do with the stack. It is mostly wing, so
normalisation makes the *wingspan* its unit rather than its length. Its wingbeat
lags the hand a sixth of a beat behind the arm — the whole difference between a
wing and a pair of scissors — and it crosses banked over, because a wing seen
edge-on is a line.

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

### Scroll

Five things on the page answer the scroll. Each one is tied to the scroll
*position*, never to a timer, so scrolling back runs it backwards and a reader
who stops stops it.

| What the reader sees | Where | What drives it |
| --- | --- | --- |
| A theropod's trackway along the top edge: one print for every stretch read, the newest fresh in the accent, the older ones drying out | `ReadingTrail.tsx` | one passive listener, which writes only when a print lands or lifts — a few dozen times down the whole page |
| The time of day behind the page: morning under the hero, a clear sky through the middle, an evening over the work, night and stars behind the contact — with a sun that comes up as the page is first moved, crosses the top of the screen and goes down into the dusk, and a young moon that is up by the time the stars are | `ScrollSky.tsx` | Web Animations on the document's `ScrollTimeline`, on the compositor; one listener where the browser has none |
| The marquee runs faster the faster the page goes, turns round when the reader scrolls back up, leans into its speed and all but stops under the pointer | `Marquee.tsx` | its own frame loop on `window.scrollY`, asleep while off screen |
| The projects as a row the page slides sideways: the section pins for exactly as long as the row needs, each card swings round to face the reader in the middle, its cover lagging and its numeral running ahead | `ProjectGallery.tsx` | the page scroll sets the row's `scrollLeft`; each card's motion is a CSS view timeline |
| A flight through the technology universe: in from far out while the technologies gather into their sphere, the composed shot while the stage is wholly on screen, then in over the cloud as it leaves | `universeFlight.ts`, `UniverseScene.tsx` | the canvas's own place on the page, read in its frame loop |

Every curve is a pure function — `src/lib/scroll.ts` and `universeFlight.ts`,
neither of which imports React or three.js — and `tests/unit/scroll.test.ts`
holds them to what they promise: prints only ever land in order and the last
lands at the bottom, the sky never goes dark in the middle of the page, a low
sun always has a glow under it and is never up with the moon, body copy keeps
its contrast over every part of either, the marquee turns round and comes back to its drift, the gallery's page-to-row
mapping is its own inverse, and the camera never flies into a node.
`tests/e2e/scroll.spec.ts` drives the real page, on a desktop and on a phone.

What is load-bearing:

- **The projects row is a real horizontal scroller, kept in step both ways.**
  The obvious build — a strip moved with a transform inside a pinned box — has
  no way to show a card that receives focus: a browser brings a focused element
  into view by scrolling its containers, and a transform is not a scroll. Tab
  walked into cards that stayed off screen, and so did the test suite's
  `scrollIntoViewIfNeeded`. Now the page scroll writes `scrollLeft`, and a
  `scrollLeft` this code did not write — a swipe, a trackpad, focus — moves the
  page to the matching place. Mostly-sideways trackpad gestures are left to the
  row with `data-lenis-prevent-horizontal`; Lenis already ignores purely
  sideways ones.
- **The cover and the numeral take the card's timeline by name.** An anonymous
  `view()` belongs to the nearest scroll container, and the cover's clipping
  box is one — `overflow: hidden` still scrolls, to a script — so they timed
  themselves against a box that never moves and drifted off on the overflow
  their own transforms created. The card declares `view-timeline:
  --gallery-card inline` and both follow that.
- **The last card travels to the middle.** The row's end padding is half the
  screen less half a card, so the last one gets its turn facing the reader like
  every other, and the count reaches it. Before, it stopped at the right edge,
  half turned away, with the counter one short.
- **The sky is only ever faded and slid.** Four soft layers, each with one
  opacity-and-translate animation, which the browser runs off the main thread.
  Animating their colours instead would repaint four full-screen gradients on
  every scroll frame. The keyframes and the fallback are built from the same
  table (`SKY`), so the two paths cannot disagree.
- **The sun and the moon are two more of those animations, not a second
  mechanism.** A stop can carry a sideways drift and a size as well, so a path
  across the screen is just a curve with more stops: `SUN` and `MOON` are arcs
  (`rise`, `set`, where along the horizon, how high), sampled into thirty-odd
  stops, and the sun's two colours — red on the horizon, pale overhead — are two
  discs cross-faded the same way. The arc climbs at a walk and then runs along
  the top of the screen for most of the day, because that is the one band of a
  page nobody is reading; the moon goes up the right-hand edge into the top
  right corner, which is the only place the footer leaves empty on a phone and
  on a desktop alike.
- **They sit behind the text, so their brightness is a contrast budget.** In
  the dark theme a disc bright enough to look like the sun would wash out
  whatever paragraph was over it, so it is a dim disc with a brighter rim and a
  glow, and the moon is a thin lit edge on a disc of earthshine. In the light
  theme the sun's face is lighter than the page, which costs dark text nothing.
  `tests/unit/scroll.test.ts` reads the tokens out of `globals.css`, paints each
  part of each disc over the strongest light of the sky that can be under it,
  and requires 7 : 1 for headings and 4.5 : 1 for body copy. The faint labels
  (`--fg-3`) are the price: they start near 4 : 1 and 3 : 1 and can drop to a
  little over 2 : 1 for as long as one is directly over the disc. The moon's lit
  edge is the one bright thing in the sky; it is a few pixels wide.
- **The sky is timed by section, not by how far down the page a section is.**
  `SKY`, `SUN` and `MOON` sit together in `lib/scroll.ts` and are all in one
  unit, the time of day from 0 to 1, tuned against each other: the sun is low
  only while a glow is under it and high for the whole of the clear sky; the
  moon is not drawn before the stars. `HOURS` then says what time it is where:
  the about section arrives at 0.057, the projects at 0.539 and let go at
  0.775, and so on. `measureDay` turns that into a clock for the page as it is
  laid out now, and `curveKeyframes` puts a keyframe at every hour, so the
  browser still runs the whole sky itself. The first version read the page
  straight through, top to bottom, and the same section sat at a different
  hour on a phone than on a desktop — the GitHub section starts 76 % of the
  way down one and 81 % down the other — so on one of them the setting sun
  hung over the numbers for as long as anyone read them. Now the sun goes
  down while the projects row is still pinned, behind its cards, on both.
- **The clock is measured again whenever the page changes shape.** Sections
  load late, the GitHub section grows when it answers, a phone is turned.
  `animateThroughDay` watches the body's size and the window's, and re-ties the
  curves only if an hour has actually moved. A section that is not on the page
  is skipped; a new one between two hours takes its share of the time between
  them, so a long scene after the hero is a long morning and nothing in the
  table needs retuning. Two hours with the same time hold the sky still across
  the stretch between them.
- **The universe holds still while it can be pointed at.** The flight leaves
  the shot the section was composed around exactly as it was for the middle
  fifth of the stage's passage, which is when the whole stage is on screen.
  `FlightRig` places the camera and is mounted ahead of the constellation, so
  its frame reads the canvas's rect before anything else that frame has written
  to the DOM. A canvas back from being parked takes up the new shot at once
  instead of sweeping across from where it was left. Labels fade in flight: far
  out they would crowd a cloud the size of a coin, and close in they would swell
  across the lens.
- **Reduced motion.** The projects are the plain grid, the marquee is a still
  row, the sky changes its light but does not drift, the sun and the moon come
  and go where they would hang highest instead of travelling, and nothing
  twinkles. The trail stays — it is a progress indicator — but lands without its little
  press.

What it costs, scrolling the whole page at 1,400 px/s in headless Chrome on an
M2: 60 fps in every section at DPR 1 and 2, and on a phone-sized viewport at
DPR 3; with the CPU throttled four times on that phone, 56–60 fps.

**The GitHub section is the one thing here that is tied to being seen, not to
the scroll position** — it has to be: its data is not there until the reader
is nearly at it. The first time each number is on screen it counts to its
value (`CountUp.tsx`), and the first time the graph is, it draws in as a wave
from the oldest week to the newest with a patch of light running ahead of the
front (`ContributionGraph.tsx`); the language bars and their shares do the
same. Both run once and are not replayed by scrolling away and back.

- **The numbers are GitHub's and only their arrival is animated.** `countAt`
  (`lib/count.ts`) only ever moves towards the value, in whole numbers, never
  passes it and ends on exactly it; `formatCompact` writes every frame, so a
  count through a thousand turns into "1.2K" the way the final figure is
  written. The year the account was made is counted *back to* from this year —
  a year is not an amount, and 0 → 2021 would say nothing. While there is no
  number there is still a skeleton, never a zero.
- **A screen reader is told the answer, not the count.** Each number is in the
  page twice: the value, visually hidden, from the moment it exists; and the
  figure on its way there, `aria-hidden`. The same goes for anything that reads
  the document rather than watches it.
- **How long a count takes goes by the size of the number, not the number**
  (`countDuration`): seven is there in under a second and three hundred and
  sixty-five takes about a second and a half, so the row lands left to right
  instead of all at once, and nothing sits on its second-to-last value — which
  is what a floored count does, because the last step of an ease-out is the
  slowest.
- **The wave is one delay per cell and nothing per frame.** `waveDelay` gives
  each cell its turn — a little after the one to its left and the one above it,
  so the front leans — and the crossing takes 900 ms whether there are 53 weeks
  on a desktop or 26 on a phone. Cells animate transform and opacity only; the
  light is one element slid across once. The graph used to fade its columns in
  with a 14 ms stagger and no shape to it.
- **Reduced motion:** every number stands at its value from the first frame,
  the graph is simply there, and the bars are full.

### The long walk

Straight after the hero the page stops, and for about eight screens of scrolling
it is one pinned 3D scene: people getting up from a fire and leaving a cave, a
hunt, the land settled while three days go by in a few hundred pixels, a city
putting itself up, and one lit window with somebody at a screen behind it. The
camera goes in through that screen, and what scrolls up next is the page.

`sections/Evolution.tsx` is the gate (three-free: it decides whether the scene
exists, holds the tall element and writes the captions), `lib/evolution.ts` the
part of it the rest of the page reads, `EvolutionScene.tsx` the canvas, and
everything else is a family of `evo*` files under `components/three/`.

| Era | From | What happens |
| --- | --- | --- |
| `fire` | 0 | Embers at the back of a cave; the fire catches; three of the four people round it get up and go |
| `hunt` | 0.2 | Out of the mouth into the sunrise; a herd at the water; stalking up close through the grass, one spear, the herd gone and a run after it |
| `field` | 0.47 | The camera climbs; three days and nights go by; roofs, ploughed strips, a track |
| `city` | 0.645 | Tashkent rises out of the ground one block at a time; across a square, a white mosque and the television tower against the sunset; lamps and windows come on |
| `now` | 0.905 | Over the road on the crossing, through the glass, over a shoulder, into the monitor |

**The whole walk is a function of one number** (`evoScript.ts`): how far the page
has been scrolled through it. Where the camera is and what lens it has, where
the sun and the moon are, what the light is like, what exists, where every
hunter and every mammoth stands — all of it, with no clock, so it runs forwards,
backwards or not at all exactly as the reader's hand does, and a test can ask
for frame 0.413 without having played the frames before it. Tracks between keys
are monotone cubics rather than Catmull-Rom: a Catmull-Rom spline swings past
its keys, which for a camera a metre and a half off the ground means dipping
into it and for the sun means setting twice. The sun rises straight out of the
mouth of the cave and sets ahead of the walk behind the city, which a real sun
cannot do in one day; its circle is swung round while it is going round three
times, where nobody can see it done. It is swung once before that, too, and in
plain sight: on the steppe it climbs away to one side of the way the hunt goes.
A sun dead ahead of the camera leaves everything the camera is following a
black shape, and the hunt is the one place the people and the animals are
looked at closely — through a long lens, from a few metres behind the hunters,
with the herd filling the frame beyond them.

**Steps are the one thing that is not.** Where a figure is, is a function of the
scroll; its stride is counted forward from how far it has moved since the last
frame, at no more than the pace a body keeps (`evoCast.ts`). Flick the wheel and
a hunter covers thirty metres in a breath — at a run, not with its legs a blur.
Stop, and everyone on the page settles into standing, breathing and looking
about, where a clip scrubbed to that frame would have left them frozen in
mid-stride. The city does not wait for the scroll at all: traffic and the
people on the pavement keep their own time.

**The people and the mammoths** (`evoFigures.ts`) are sculpted the way the
creatures are — masses and tubes in one signed distance field, meshed in the
worker — with differences that are the reason they have a file of their own.
They are authored in metres, and the payload says how tall they came out. They
are more than one material: every shape belongs to one of eight regions (skin,
the scalp under hair, pelt, leather, two cloths, horn, the sole of a shoe) and
each vertex is given its share of each from which region's shapes it lies
nearest, so one seamless mesh is coloured by weights, with a few painted marks
on top — blood near the surface of a cheek, the shade round an eye, a brow, a
lip. And they are skinned by *reach*: every bone has a girth and a side, and a
vertex goes to the bone whose surface it is nearest on its own side of the
body. Distance to the axis alone gives the ribs to the upper arm, which hangs
closer to them than the spine does.

What makes them look like people and animals rather than like clay is four
things that are not in the field at all:

- **A coat** (`evoCoat.ts`, `makeCoatMaterial`). A sculpt has no hair, only a
  smooth mass the shape of a head of it. So fur and hair are grown on the
  finished mesh, in the worker: a few thousand narrow strips, each rooted at a
  point on the surface, lying the way the hair is combed there, as long as the
  hair is there, and carrying the bone weights of the skin under its root. They
  are drawn as instances of one strip with the figure's own skeleton; the
  vertex shader turns each downward under its own weight after the skin has
  been posed (so it is the posed animal's coat that hangs), lays it on the
  surface where that curves away under it, and throws it about with the
  wearer's stride; the fragment shader cuts it into strands. A mammoth is
  eleven thousand of them and is mostly coat: the mesh underneath is the animal
  shorn. Someone from the cave has seven thousand — hair, a beard, and the fur
  of a tunic and boots.
- **A face and hands fine enough to have features.** `meshSdf` has an `exact`
  mode for these figures: every vertex is moved onto the field's own surface
  and given the field's own gradient there (surface nets alone rounds off
  anything a cell or two across), the grid is sampled only near the surface to
  pay for it, and `refine` halves the triangles where it is asked to — a face
  is meshed four times as finely as a thigh, and its eyes, nose and mouth eight. A shape can also be given a
  fillet of its own (`blend`): the centimetre and a half that joins a thigh to
  a hip is the end of a nostril.
- **Eyes.** A ball behind each pair of lids, parented to the head bone, with an
  iris and a pupil and the one glossy surface on the figure. A socket carved in
  a field and shaded dark reads as a hole.
- **Tusks that are swept, not sculpted** (`CreatureSweep`). A field sampled on a
  grid loses whatever is thinner than a cell, which is the last half-metre of a
  tusk, and joins the rest of it out of straight pieces. A circle swept along a
  curve is a mesh that can be made exactly.

Things there that each cost a round:

- **A tube has to be one shape.** `tubeToCones` cuts a limb into capsules, the
  mesher filleted each to the next, and a smooth union of two overlapping
  capsules bulges — every limb came out as a string of beads. Shapes that share
  a `group` are now joined with a plain minimum and only the whole is blended
  (`SdfCone.group`). Left out, every shape is its own group, so the creatures
  are meshed exactly as they always were.
- **The mesher's ellipsoid distance is not a distance.** It is scaled by the
  smallest radius, which is right at the surface and far too small away from
  it for a flat shape: asked which region a vertex belonged to, a thin slab of
  chest muscle claimed the front of every jacket. `nearestFields` uses the
  first-order estimate instead, and what is worn is given a centimetre's
  preference over what wears it.
- **A request the worker has had for four seconds is redone on the main
  thread** (`PATIENCE` in `useCreature.ts`), which is right for a creature the
  page is waiting to show and wrong for these: the crag the cave is cut into
  was first meshed finely enough to take eight seconds, and the page stopped
  dead while it was built a second time. It is coarse now on purpose, the cast
  asks for one mesh at a time (`inTurn`), and it tells the worker to take as
  long as it needs — the walk is built before it is looked at.
- **Half-covered is a screen door.** A coat is not blended: it is written to
  the depth buffer like anything solid, with how much of a pixel is hair handed
  to the multisampler as coverage, so it needs no sorting. But a lock whose
  strands have gone finer than a pixel is evenly half there, and the
  multisampler draws "half there" as a fixed stipple. So the strands are never
  blurred into a grey: the further off a lock is, the fewer and wider its
  strands — half as many each time they would have gone under a pixel and a
  half — until it is one lock coming to a point.
- **A lock is the sum of the way it has gone.** Placing each row of a strip
  along the direction it had turned to by then, from the root, made anything
  that started upwards — the ruff at a neck — double back on itself in a
  zigzag. Each row is now the one before it plus a step, so a lock that starts
  upwards rises, arcs over and falls.
- **A flat strip shines all over at once.** Light off hair is a streak along
  each strand (Kajiya and Kay), and on a strip with one normal the streak is
  the strip: a head of planks. Each strand is tilted a little differently, so
  each has its streak somewhere else.

**They move by having their feet put down** (`evoRig.ts`). A pose is a short
list of numbers a person could be told — how far the hips have dropped, where
each foot is, how far each arm has swung — gaits write those from a phase, two
poses blend by blending the numbers, and one function turns the result into
bone rotations, solving each leg from where its foot has to be. A stride clock
that swings the hips and knees and hopes the sole ends up level is how a figure
comes to skate. The mammoth is the same solver on four legs, with the legs'
top joints inside the body where an elephant's are — and its body is carried
on those legs, not posed over them (`applyBeast`). Each end of it is as high as
the legs under that end can reach: highest passing over a leg that is upright,
lowest when one foot has just landed ahead and the other is about to leave
behind, with the heel coming off the ground first. Posed at a fixed height it
had to be low enough for the longest reach, and then every leg that bore weight
was bent — an animal that looked as though it was creeping. An elephant's legs
are straight when they carry it; its back is what goes up and down.

**The country** (`evoLand.ts`) is one strip seven hundred metres long: high
ground with the cave in it at the west end, steppe and a pond in the middle,
level ground at the east end for the city. The floor of the cave is this mesh
too — the crag over it (`evoCave.ts`) is a mesh of its own, hollowed out to just
inside `caveFootprint`, so the height field only climbs again inside solid rock.
A ring of ranges stands a kilometre off, and its skirt runs in under the edge
of the land so no gap ever shows between the two from a height. The grass
(`evoGrass.ts`) is not the valley's: that is a fan laid out once in front of a
camera that stays put, and this camera travels half a kilometre. Here every
instance has a cell of a grid that covers the whole country and draws the blade
of whichever cell of its row and column is nearest the camera, so blades that
fall off the back of the window turn up at the front as the blades that were
always going to be there. Whatever walks through it parts it. Where the city
comes it thins by degrees — except on the street and the square, where it is
gone the moment they are laid: paving is paving from the day it goes down.

**The city** (`evoCity.ts`) is Tashkent, and it is still one instanced box.
The layout is that city's: four to nine floors along a street and nine to
sixteen behind, the few glass towers all together at the far end of the avenue,
a hotel that is a long slab faced with a lattice, and on the far side of the
road a square with nothing built on it. Everything that makes a box a building
is in the fragment shader, by kind: panel blocks with loggias — some glazed in,
each by its own household — cast sun-screens over the stairs and a mosaic on
the blind end wall; yellow brick with pilasters and a cornice; rendered blocks
with glass balconies; curtain wall. An opening is not painted on. The ray from
the eye is carried on through it (`evoInto`) to whichever inside face it meets
— the back of a room, the side wall of a loggia, the shelves of a shop — so
walking past a lit front, what is inside slides behind the frames the way it
does. By day the glass shows the sky and at the right moment the sun. Ground
floors on the street are shops, and their signs are words drawn into a canvas
(`evoSigns.ts`): what each one sells, in Uzbek, and never a name. The street is
a shader too: asphalt and its paint, a zebra crossing where the walk goes over,
setts with a red band along the kerb, a square of earth round every tree, and
lamp pools — and what a wet patch throws back of them — worked out from where
the lamps are, with no lights in the scene. `evoStreet.ts` is where the kerbs,
the lanes, the lamps, the crossing and the square are written down once,
three-free, for the city, the traffic, the trees and the tests to agree about.

**What makes it Tashkent** (`evoTashkent.ts`) stands on that square and over
it: a white mosque with a turquoise dome and two minarets, after the one on the
Anhor; the flag; a fountain; the country's name on the roof of the hotel; and
seven hundred metres off, the television tower on its three legs. It is a
Tashkent put together out of its landmarks, not a map of it — they do not stand
this close to one another. Everything that stands still is one mesh and one
program. Each vertex carries what kind of surface it is on and where on that
surface it is, in metres, and the fragment shader draws marble in courses,
tilework, pierced lattices, a carved door and lit windows from that, the same
way a block of flats is drawn from a box. None of it takes one of three's
lights: the sun, the sky, the street's lamps, the square's lanterns and the
floodlights are all worked out in the shader, so there is one program however
the walk is lit and nothing to rehearse.

The tower is where it is for three reasons, and each of them is a test. It
stands on the plain: the ranges begin a little further out, and a tower on a
mountainside is not this one — which is also why it is seven hundred metres off
and not the kilometre and more it was first put at. It is under where the sun
goes down, so the last of the daylight is behind it. And nothing is built on
the lines from the near pavement to it (`beforeTheTower`), so across the square
it is seen whole, legs and all, between the minaret and the corner of the
studio's building. The flag is drawn to its own measure — three bands and two
red lines in 80 : 5 : 80 : 5 : 80, a crescent and twelve stars in rows of three,
four and five — and stands at the corner of the square the walk reaches first,
where from across the road its pole goes up beside the dome and the cloth is in
the sky above it. The lights at the crossing hang on two lamp posts that were
already there and turn with `crossingHeld`: the walk is what they change for.
The trees are kept out of all of this by a test as well: none may stand where,
from the pavement opposite, its crown would be in front of the flag, the dome,
the portal, a minaret or the tower. That is why the far kerb is bare from half
a gap before the square, and why the square's own trees are at its back
corners — beside the mosque, never behind the dome — and at the back of the one
lawn, with none on the lawn the tower is looked at over.

**The trees** (`evoTrees.ts`) are planes, the *chinor* Tashkent is planted
with: a trunk limed to chest height, bark coming off in plates of three or four
ages, and a crown. The crown is cards — thirteen hundred of them, a handful of
leaves on each, and the leaves *drawn*, five lobes and a tooth on each shoulder,
so there is no texture and a leaf is as sharp at two metres as at twenty — hung
round some twenty rough balls that carry the same leaves, darker. The cards are what
is seen; the balls are a back for them. There are never enough cards a pixel to
close a crown by themselves, and with nothing behind them the sky comes through
everywhere at once, as glitter; with a plain green ball behind them it comes
through nowhere and the ball shows as a boulder. Their edges go to the
multisampler, like the hair's, and for the same reason nothing is ever faded
out with distance: a leaf has its bays filled in, then the leaves swell until
they meet, then a card is a disc — each card at its own distance — so what the
multisampler is handed is always a shape and never an even half, which it draws
as a screen door. A card is lit as the crown is and not as it happens to be
turned: it takes the direction the crown faces where it hangs, so a crown has a
lit side and a shaded one, and leaves between the eye and the sun let it
through. None of this is lit by three's lights. A material that is has a
program for each number of lamps in the scene, and the walk has three; these
have one, take the sun and the sky as two colours, and work out the street's
lamps from where `evoStreet.ts` says they stand. One pattern tree is round, and
there are three patterns; a tree on a kerb has its crown pressed narrower
across the street, where the fronts are, and pushed out over the road, as it is
drawn. And a tree brings its ground with it — the square of earth it stands in,
and the shade of its crown and trunk, multiplied into whatever is paved there —
so the street's shader does not know where the trees are, and one planted
anywhere `treeSpots()` says has both.

**The traffic** (`evoCarShapes.ts`, `evoTraffic.ts`, `evoCars.ts`) is five
bodies and a rule for driving them. A body is lofted, not modelled: its side
view and its plan are a handful of points each, and every cross-section has the same
thirty points in the same order, so a bonnet is a cabin whose roof has come down
to its belt line and one function makes a hatchback and a bus. Sections are put
exactly where a window, a pillar or an arch starts and stops, so the edge of the
glass is the edge of a face; anything smaller than a panel — lamps that come
round the corners, the grille, the lines the doors shut on, the seats and the
driver seen through the glass — is drawn on the skin from a few numbers. There
is nothing for the paint to reflect, so it works out what it would see: the
sky's gradient over the roofs, the lit shop fronts along each pavement (none
where the far side is the square), and the six nearest street lamps from
`STREET_GLSL`, the numbers the road is lit by, which is what slides a lamp over a
bonnet and up a windscreen as the car passes under it. Lamps are brighter than
white for the glow to find; where a frame gets no glow, a halo sees that from
what it is being drawn into and stays. The plates have the country's layout and
made-up numbers. The driving (the Intelligent Driver Model; a lane is a ring and
nothing overtakes) keeps its own time and knows two things about the walk: the
crossing's lights, from `crossingHeld`, and where the camera is. On amber a car
that can pull up for the line does; on red nothing crosses it; and because a
scroll can take the lights from red to "the stripes must be empty" in a tenth of
a second, whatever is still on them is carried off in step with the change
rather than left to drive. Nothing comes within 1.5 m of the camera — what is
coming stops short of it, and a scroll that puts the camera down on a car moves
the car — and a walk that steps into the road short of the line is waited for
where it stepped out. `tests/unit/cars.test.ts` measures the bodies and drives
the street for the best part of half an hour, a step at a time, asking all of
that at every step.

**The air** (`evoAir.ts`) has a sun that moves, so nothing about it is a
constant and nothing is a module-level singleton either: `createAir()` makes
the one set of uniforms a scene shares between its dome and every material
standing in its haze. `inAir()` stands one of three's own materials in that
haze — in linear light, before tone mapping — and scales the sky's light by how
much sky a point can see (`evoOpen`): the sky lights from every side at once, so
nothing shadows it, and without that the inside of the cave is lit like the
hillside it is under. A material's own declarations go at `PARS_HERE`;
replacing `#include <common>` a second time puts them *before* the air's, which
they call.

**The lens** (`evoPost.ts`) is not the valley's glow. That is a second drawing
of the things that burn, laid over a frame tone-mapped material by material —
right for a scene that shares a page with paper. Here the whole frame is the
scene and nearly everything in it is lit by something brighter than white, so
it is drawn once into a floating-point frame with nothing clipped, what is over
white is blurred down and up a short pyramid and added back, and the result is
tone-mapped once on its way out. Programs are compiled for what they are drawn
into, so the warm-up binds that frame first; compiled for the screen they would
only be compiled again on the frame they were first needed.

| | low | medium | high | ultra |
| --- | --- | --- | --- | --- |
| Resolution | 1× | 1× | up to 1.4× | up to 1.6× |
| Shadows (sun, and the fire's) | — | 1024 | 2048 | 4096 |
| Glow | — | — | ✓ | ✓ |
| Grass (fine blades / tufts) | — | 29 000 / 36 000 | 62 000 / 84 000 | 109 000 / 144 000 |
| People and mammoths | low | low | medium | high |
| Locks in a mammoth's coat | 1 900 | 3 500 | 6 800 | 11 400 |
| Cars | 10 | 20 | 32 | 44 |
| Leaf cards on a street tree | 520 | 845 | 1 300 | 1 300 |

The levels are the valley's (`valleyQuality`), and like the valley the scene
judges itself: if most of eighty frames are slow it gives up a fifth of its
resolution, twice at most, through the canvas's own `dpr` prop. A coat is also
drawn by distance: all of it from within two and a half times its wearer's
height, and from there fewer locks, each wider, down to a little over a quarter
of them — they are shuffled when they are grown, so any first part of the list
is the whole coat thinned out. And the meadow is trodden down for a few paces
round the lens (`uNear` in `evoGrass.ts`): the hunt is followed from low in the
grass, where a blade a pace from the camera is a green wall across the frame
and, drawn over and over at that size, was most of what the frame cost. And a
blade that cannot grow — where the city has taken the ground, or outside its
window — is put away before any of the work of growing it. Over the city that
is nearly every blade in the window, and when each was still grown in full,
wind and all, only to be folded away under the ground, the first look down the
avenue was where a Retina screen gave up its resolution.

It is built ahead of being seen — the chunk is fetched and the scene mounted,
parked, three seconds after the intro, or as soon as a reader has been near it
for a quarter of a second; a jump straight past it builds nothing. Where WebGL
is drawn by the CPU it waits six seconds for someone who has plainly stopped to
look. It draws only while the stage is on screen and the extinction cinematic
is not. The scroll companion and its
cameos step aside for as long as it is. With reduced motion, or without WebGL,
there is no walk at all: the page goes from the hero to About.

Being built ahead is not the same as being ready, and the difference was a
stall of a tenth to a third of a second at every change of scene. Three things
are done about it, all in `EvolutionScene.tsx` — and none of them where WebGL is
drawn by the CPU, where a program is seconds of the whole machine and building
them all ahead froze the page for most of a minute on a CI runner, for a reader
who had only stopped near the walk. There each program is built by the first
frame that needs it:

- **Programs are compiled for every lighting** (`walk.rehearse`). A program is
  built for a number of lights. The walk has three — the fire in the cave, the
  sky alone, the lamp in the studio — and a program compiled while the fire was
  the only lamp lit was built again on the first frame out of the cave.
- **Every set is drawn once before it is seen** (`walk.warmups`). A compiled
  program is still made ready a second time, by the driver, on the first frame
  something is drawn with it. So each set is drawn once in each lighting into
  an eight-pixel corner of the frame, one small job at a time when the page is
  idle, and again whenever a mesh arrives from the worker.
- **Whatever casts a shadow and is instanced or skinned has a shadow material
  of its own** (`ownShadow`). three casts every shadow with one material and
  gives it a new program each time the kind of thing being drawn changes, filed
  under the number of lights lit at the time — which a shadow does not use. The
  first roof of the village, drawn after the fire had been left behind, was a
  new program in the middle of a scroll.

### The extinction cinematic

Clicking the name in the nav — the one in the header, not the headline — puts the
page aside for about twenty seconds and shows what the valley looked like
before any of this, and what happened to it. `src/lib/valley.ts` holds the act, `ValleyScene.tsx` plays
it, and `Hero.tsx` takes the headline down for the duration.

| Act | Seconds | What happens |
| --- | --- | --- |
| `load` | — | Mounted and compiling off the main thread; nothing shown, the hero still moving |
| `open` | 2.4 | The mist lifts and the camera settles into the valley |
| `graze` | 4.2 | Two sauropods, two stegosaurs, a tyrannosaur, two turtles, three pterosaurs over the ridge, at the size they were |
| `streak` | 2.6 | Something comes down out of the north-west, and every head comes up |
| `impact` | 1.8 | White-out, shockwave, fireball, the crater opening and throwing its floor back out |
| `die` | 3.4 | The blast front lays the herd down and the valley catches fire behind it; the flyers come out of the sky; the column climbs |
| `dark` | 3.2 | Smoke over the burning valley and only the fire to see by; the camera climbs until the crater is below it |
| `return` | 3.6 | Morning over the ash, and the headline growing back into place |

Nothing in it is meshed on demand. `Valley.tsx` dynamically imports a warm-up
nine seconds after load, which builds all five species into the shared creature
cache while the visitor is reading; on the first click that work used to happen
with the camera already pointed at an empty valley, and the opening held for the
better part of twenty seconds. Nine seconds, and a gap between each species,
because there is one creature worker: queued back to back at four seconds the
warm-up sat in front of the cameos, and the slowest case for the companion
appearing went from nine seconds to fifteen. There is also a six-second backstop
on the wait, so a slow machine gets the cinematic late rather than not at all.

It gets its own full-bleed `<Canvas>` rather than borrowing the hero's, which is
inset on wide screens and would have left a seam down the left of the sky. The
canvas exists only while the cinematic runs. `Valley.tsx` is the gate and stays
three-free so none of this is in the main chunk; the fade in and out is a CSS
keyframe rather than React state, because a `setState` in an effect to run a
fade is a re-render per frame for something the compositor does for free.

Everything is procedural like the rest of the site, and it is split seven ways:
`valleyLand.ts` is the height field, the scatter, the crater and the blast
front, `valleyMaterials.ts` the shaders (and the wind, and the fire),
`valleyForest.ts` and `valleyFlora.tsx` the trees and ferns, `valleyGrass.ts`
the meadow, `valleyMountains.ts` the ranges beyond the valley, `valleyFire.ts`
where the valley burns, and `ValleyScene.tsx` the cast, the rock and the
timeline.

**The land.** A displaced plane: value noise for the ground itself, ridges on
both sides and a rise at the far end so the camera looks *along* a valley rather
than across a field, a lake blended in as a bowl on the low side, and a volcano
at the head of the valley that is part of the height field rather than a cone
stood on it — so it gets the same rock, strata, bump and mist as the ridges and
meets them without a seam, with a crater at the summit for the vent to smoke
from. The ridges are **capped**. Uncapped they were mathematically correct and useless — at the
back of the valley the camera can see about seventy-five units up, the walls
were past a hundred long before the plane ran out, and the result was a frame
with no sky in it at all. The cap is the composition. The ground is coloured per
pixel rather than per vertex: moss where it is low and damp, dry grass and earth
on the open floor, banded rock wherever it steepens or climbs, all broken up by
noise at four scales, with the Mikkelsen surface-gradient bump the hide uses
adding relief that fades out with distance before derivatives of noise turn to
shimmer. Mist pools on the floor — thicker low down and further off — as a
chunk injected after three's own fog into every material that stands in it,
and the haze is brighter and warmer looking towards the sun and cooler away
from it, which is most of what tells the eye how far off a ridge is. The fog
starts at 110 and is complete at 540: at 400 the far ridge and the volcano
were cream silhouettes.

The rock has **relief no mesh carries**: ridged noise, crags on the ridges and
on the volcano gullies that run from the summit to the foot, evaluated once a
pixel *with its gradient* (value noise has an analytic one) and turned into a
normal. It holds at any distance, which the bump does not — the volcano is two
hundred and seventy units off, and its gullies are what make it a mountain
rather than a heap of sand. Differenced in world space it cost three
evaluations a pixel, five milliseconds a frame on a retina screen; taken from
screen derivatives, which come in two-by-two blocks, it was a staircase. The
volcano itself is dark basalt in the gullies, pale ash on the ribs, old lava
flows in darker tongues from the rim and rust towards the vent, with the forest
climbing its foot.

Two things about the ground were wrong for a long time without looking wrong.
Most of the valley floor lies *below* the lake's water line, so everything that
decided "shore" by height alone — the dark, glossy wet margin in the shader,
the rule that keeps plants out of the water — treated the whole floor as
shore: it was the shiny crumpled-foil look the foreground used to have, and
the reason nothing grew on it. Both now go by distance from the lake. And the
lake's bowl was blended into the ground over half a radius past the shore,
which on the west side, where the lake sits against the valley wall, made a
sixty-degree cliff fifteen metres high that the rock shader could only
stripe. The blend now reaches 2.7 radii, and outside the shore the bank never
climbs above the ground it is blended into, or the near side becomes a dam
between the camera and the water. `tests/unit/valley-world.test.ts` holds
both: the bank's steepest slope, and a clear line of sight to the water.

**The forest.** Jurassic ground cover was ferns and cycads; the trees were
conifers, and the ones that read as *that period* to anyone are the araucarias,
a bare trunk with an umbrella of branches at the top. Two conifer shapes, a tree
fern and a ground fern, each authored once as one merged geometry and planted
hundreds of times as an `InstancedMesh`, so the whole forest is four draw
calls. Placement is rejection sampling with a rule per species — conifers keep
to the slopes and the head of the valley, tree ferns to the lake shore, nothing
grows through an animal or in the water — and it is seeded, so it is the same
forest every showing.

The conifers are built the way real-time trees are: a trunk, and branches that
are **cards** — crossed pairs of quads, drooping and curling up at the tip,
carrying a spray of needles drawn on a canvas and alpha-tested — so a crown has
a ragged edge and sky through it. They used to be stacked cones, which read as
plastic lampshades from any distance. Three things make a heap of cards read as
one crown: every card takes the crown's own outward normal rather than its flat
one, so the mass shades from its lit side to its shadowed side the way foliage
does (and both faces take it, or the back of every card would be lit from
inside); vertex colour darkens towards the trunk and the bottom of the crown,
where little light gets in; and each branch is a little lighter or darker than
the next. Alpha is held up as the texture goes down its mip chain, or
alpha-tested foliage thins to nothing with distance. Bark shares the needle
texture, on the *left* of it: on the right, beside the tips, the coarse mips
ran the two together and every distant branch ended in a brown smudge. The
fern's frond is drawn the same way, and its fronds take crown normals too — a
bent plane's own normal faces down on half of every frond, and a field of ferns
lit by them was black.

Everything that grows moves in **one wind**. A gust is a soft patch of stronger
air that travels downwind at about five metres a second, read by the grass, the
ferns and the conifers from the same function, so a gust is seen to cross the
meadow and then reach the trees. The plants lean with it and rock about the
lean, more at the crown than at the root — in the wind's direction on the map,
turned into each plant's own frame, because instances are yawed at random and a
sway along local x sent every tree a different way — and the leaves flutter on
top, more the further they stand from the stem. Light comes through the leaves
and the blades from the low sun behind them. The ones within reach of the
impact go over as the blast front passes, away from it — for a while the axis
was wound the other way and every tree in the valley fell towards the blast —
and what stood where the crater opens is gone with the ground under it.

**The meadow** (`valleyGrass.ts`) is up to a hundred and sixty thousand blades
that are never placed on the CPU. A blade is seven vertices near and one
triangle far, drawn instanced; the vertex shader works out from the instance's
number alone where it stands — in a fan that opens down the valley from just
behind the camera, rows further apart with distance and columns spreading with
the angle, as wide as the lens takes in, so a wider screen gets more blades and
not sparser ones. Each stands on the mesh exactly (the terrain grid itself, in a
float texture, over the same two triangles per quad `groundAt` uses), grows by
the rules the ground's colour follows — none on rock, the shore or in the lake,
short where it is wet, sparse on bare earth — in clumps, one stem in eight in
seed, and is never drawn narrower than about a pixel where it stands, so the far
field is tufts and not shimmer. It bends along an arc: a lean of its own, the
breeze and its gusts, a flutter, and then the blast front, which lays the whole
meadow down away from the crater; round the crater it burns to stubble, in it
it is gone. Its normal is eased towards the ground's, not towards the sky: grass
on a slope facing away from the sun is in that slope's shade, and lit as if it
stood on the level it drew bright streaks over dark ground. The ground under
the blades is the shade at their roots, darker and not glossy, and past the
blades the meadow still shows the wind, a gust paling the grass in patches that
run downwind.

What a blade *is* — the ground under it, how tall it grows, its colour — does not
change while it is on screen, and working it out was most of the cost: a dozen
noise lookups for each of seven vertices of a hundred thousand blades, every
frame. So it is **baked**: drawn once into two half-float textures with a texel
for each blade, when the meadow is laid out, again if the screen changes shape
and again when the crater is cut; the blades read it back with two fetches. That
took the meadow at full density from forty-six frames a second to sixty. A card
that cannot render to float textures works it out per vertex instead. The noise
hash everywhere in the valley is integer arithmetic rather than the usual
`fract(sin(…))`, which on its own was a quarter of the frame once the meadow was
evaluating it three quarters of a million times; the integer one is also exact
at any distance from the origin. The animals stand in the grass — only the low
ones, the turtles and stegosaurs, have it trodden flat under them.

**The ranges** (`valleyMountains.ts`) are a ring of mountains well past the end
of the ground, seen only where they rise above its skyline: a polar grid round
the camera's spot, lifted by ridged multifractal noise — sharp crests, soft
valleys, rough high ground and smooth low ground, roughly how erosion leaves a
range — lower in front and higher behind, and highest in the gap down the middle
of the valley between the near ridge and the volcano, where the eye goes. What
makes them far away is the air: each pixel blends from the rock's own lit colour
towards the light of the air, the sky's own colours from the same uniforms the
dome uses with the glow round the hidden sun on top, so the ranges on that side
go pale and warm and the rest stay a hazy blue-grey; the air is thicker low
down, so their feet are hazier than their peaks. The sun is low behind them,
so what faces it is rimmed and the rest is lit by the sky; there is forest low
down, rock above, and snow where it is high and not too steep. They write the
sky's colours the way the dome does, untouched by tone mapping, so where a
range fades into the horizon the two meet without a seam — and the glow is
capped, or the fireball whitened them into cut-outs. The tests hold them above
the valley's skyline in the gap, below the volcano everywhere, and with their
feet hidden. The grid was first wound the wrong way: the slopes facing the
camera were culled and the ranges floated over a band of sky.

**The sky** on the two upper levels has a deck of cumulus rather than a smudge:
five octaves warped by a coarser noise so the shapes billow, and lit — the
density is read again a step towards the sun, and where there is more cloud
between a point and the light it is the shaded blue-grey underside, where there
is less it is the warm lit edge, and thin cloud round the sun glows through.

**The lake** reflects the same sky the dome draws: literally the same function
on the same uniforms, evaluated for the reflected ray, so whatever an act does
to the sky the water follows. Ripples are two scrolling noise fields differenced
into a normal, and they are gentle on purpose — at five times the strength the
surface was a field of random facets and the lake rendered as glitter.

**The cast** is the same rigged creatures as everywhere else, at the size the
animals were: every mesh is one unit long, so a size is a length in metres — a
twelve-and-a-half-metre tyrannosaur thirty metres from the lens, sauropods of
twenty-one and twenty-four, stegosaurs of eight and nine. They were half that,
which was fine against stacked-cone trees and bare ground and read as toys once
the trees were twenty-metre araucarias standing in a meadow a metre deep. A
mesh's facets grow with it, so the big ones are meshed finer where the card can
take it (`castDetail`): on `ultra` the tyrannosaur is the hero's own mesh,
which a desktop has already built, and the sauropods and stegosaurs are
`medium`; the small and far ones, and everything on a phone, stay `low`. The
tyrannosaur stands near the middle of the frame, because a phone held upright
sees only the middle. Each goes over when the blast front reaches it, rolled
about its own length onto its flank and lying on the ground — it used to pitch
nose-down as well, which at the real size left a tail or a neck standing out of
the ground like a horn and the rest under it — and chars as the fire behind
the front reaches it (`char` on `SkinMaterial`, which strips the hide's coat
and sheen too). Each stands with its feet on the ground, which took two things. A rig's origin is its middle and
its feet are below it, so every animal is lifted by however far its geometry
reaches down — placed at the height of the ground they were buried to the
belly, the tyrannosaur a crocodile. And "the ground" is `groundAt`, the height
of the *mesh* — the same two triangles per quad that `PlaneGeometry` indexes,
interpolated the same way — not `heightAt`, the analytic field the mesh is
sampled from: between two vertices the two disagree by up to a third of a unit,
which is a turtle buried to its shell. Each is also stood on the slope rather
than on the level, from the mesh normal under it, so all four feet meet the
ground. On `medium` and `high` the sun casts real shadows — one orthographic box over the near valley —
and the animals both cast and receive; each still stands in a soft contact
patch, dimmed, for the occlusion under the belly a shadow map is too coarse
for. On `low` the patch is the only grounding the herd has. The shadow camera is
attached as a camera of its own (`<orthographicCamera attach="shadow-camera">`)
rather than set through `shadow-camera-left` and friends: those props set the
numbers but never rebuild the projection, so the box stayed at the default ten
units and there were no shadows anywhere — on the software renderer *and* on
the real card, which is what finally gave it away.

**The rock** is a sphere pushed in and out by 3D noise at three scales, left
faceted because that is what a rock is, with ablation in the material: the face
into the wind is white-hot and the rest dull red, from the dot of the world
normal with the direction of travel. Behind it, an open cone laid back along
the flight path with its point at the rock carries the plasma — white at the
head, orange and ragged further back — with a fatter, fainter cone around it
for the glow, and a trail of smoke sprites that are born the moment the rock
passes their station (the streak's easing inverted once, by bisection) and go
on spreading through the impact and the dark. In the last stretch it breaks
up: three pieces peel away across the path, each a little behind and below the
body with a short trail of its own. The camera shudders as it passes overhead.
It lights the valley on the way down, and the crater lights it after.

**The impact** is five things at once. A white-out held against the lens. A
fireball of sprites that carry their own temperature — blackbody, roughly:
white at the heart through orange to soot at the edges as it climbs and cools —
which is not a sphere, because a sphere was an egg. The crater, opening. A wall
of dust the blast front drives across the floor at ground level, the trees
going over as it reaches them. And the column of smoke that goes up after,
sprites with a size and an opacity each, so where they overlap they do not pile
up into a black disc.

**The crater** is a simple one, the kind a rock a few metres across makes: a
bowl a fifth as deep as it is wide — twenty-two metres to the crest of the rim,
nine deep — flat at the bottom, steepest half way up the wall and rounded over
at the crest, a rim of upturned rock four metres high (higher in some places
than others), and a blanket of what came out of it thinning out to two and a
half radii (`craterProfile`). It opens in the first part of a second under the
flash, self-similarly, a small bowl widening and deepening into the whole one,
and blocks of its floor go up on ballistic arcs, come down on the blanket and
lie there cooling. It used to be cut into the ground mesh on one frame: two
and a half metres a quad, six and a half deep, and seen from beside it a
crater is a ridge — nobody saw it. It is now cut into ground of its own
(`buildCraterPatch`), a polar grid on the mesh exactly, finer round the crest,
displaced in the vertex shader by the same function the CPU uses to stand the
herd and the sparks on it; the ground under it is lowered out of the way,
vertex by vertex, only where every triangle a vertex touches lies under the
patch. In it: the beds of rock it was cut through, pale scree down the walls,
and on the floor melt, glowing all over as it forms and then cooling to a black
crust with the cracks in it glowing longest, lighting the lower walls red; the
blanket is rays of pale ejecta over the char. Then the camera climbs, out over
the burning valley until the crater is below it, because from the ground the
rim hides all but the far wall.

**The fire** comes in just behind the blast front (`blastFront` and
`blastArrival`, the same function both ways, and the same again in GLSL), a
patch here catching a little later than a patch there, and past where the
front dies out it carries on by itself, slower, up the slopes and the
volcano's foot, until all of the valley has burnt. Everything that burns asks
the same question — how long has it been burning at my spot — and goes by the
answer, so the ground, the grass, the trees, the flames and the smoke agree
about where the fire is. The ground goes to char behind the front and then to
grey ash, palest where the grass stood thickest, with flames as it passes,
smouldering patches and fine sparks in the char that go out one by one; rock
is only blackened. Grass is dried by the heat ahead of the front and burns down
from the tip to a black stubble that greys. The fire climbs a tree: the leaves
scorch brown, then burn away from a ragged glowing edge until none are left,
and the wood chars, glows in its cracks for a while and stays — a forest burns
down to its trunks and limbs. On top of that are flames — sprites on the
crowns, the ferns and the open ground, a flame drawn in each: turbulence
rising through a teardrop, torn into tongues — and smoke rising off all of it,
lit orange from beneath while the flames are under it (black on a black sky,
it was never seen). None of it moves on the CPU: each sprite is placed once,
and the card works out from where it stands when it catches, how long it
burns, how it flickers and where its smoke has got to. The light after the rock
is the fire's: the moods go from the burn to the valley on fire under the
spreading smoke, to nothing but smoke and the fire to see by, to a grey morning
through the ash, and the fill light lights the undersides of things orange
from below. The dark used to be dark — a black screen with a few embers in it,
the dust in front of the lens closing to black — and the crater, the burning
and what was left were never seen at all.

Two lighting notes, both learned the hard way. The hide is a physical material,
so with no environment to reflect it goes to near-black and the entire herd came
out as silhouettes — the scene needs `ThemedEnvironment` even though it is
outdoors. And that same environment has to *dim with the act*: left at full
strength through `dark`, it lit a sunlit valley floor under a black sky.
`scene.environmentIntensity` is blended alongside the sun, the rim, the fill,
the fog colour and the four sky uniforms, all from one `MOOD` table.

The rock's trail is a cone laid along the flight path with its point at the rock
and its length set by how far it has already come, so it streaks back across the
sky instead of hanging wherever it was authored. The ejecta are twenty-two blocks
on plain ballistic arcs, and the ash is a 340-point field whose x, z and ground
height are computed once and wrapped round to the top as each fleck lands.

The impact took four attempts, and every failure was the same mistake — giving a
thing that has no edges an edge. A flat additive ring on the ground foreshortened
into a white slab lying across the valley. An additive dome became a flying
saucer. A single dark sphere for the smoke column read as a black bubble hanging
over the ridge, and a world-space dust dome the camera sat on the lip of did the
same. What works: the blast front is a broad soft annulus in the colour of the
ground and nothing is added to it; the column is 460 soft sprites climbing and
spreading out of the crater; and the darkness is a veil held against the lens,
like the white-out, because "everything goes dark" is a thing that happens to
the view rather than a thing in the world. Both particle fields carry an
explicit `boundingSphere` — they are repositioned far from where their vertices
were authored, and three would otherwise cull them on the frame they matter.

**The click.** It used to do everything at once — fetch the chunk, mesh five
species, sample sixteen thousand heights, scatter a thousand plants, merge the
tree geometries, and then compile forty shader programs on the first frame —
and the page stood still for most of a second before the valley appeared, the
hero frozen mid-stride. Now the whole scene is built ahead of it. Nine seconds
after load the warm-up fetches the chunk, meshes the cast, and builds the land,
the forest and the ranges in slices between idle frames; when that resolves, `Valley.tsx`
mounts the scene invisibly with its frameloop parked, and the scene compiles
every program off the main thread (`gl.compileAsync`, which uses
KHR_parallel_shader_compile where it exists and polls) and then draws one frame
nobody sees, so the shadow and environment passes have run and the textures
are on the card. The click puts the store into a `load` act; the canvas answers
by flipping its `frameloop` prop from `never` to `always`, the way the hero's
does, and the first running frame starts the clock and fades the overlay up.
(Starting the loop from *inside* the scene with `setFrameloop` did not survive
the next render of the canvas, which re-applied the prop and put the loop back
to sleep after one frame.)
The hero keeps moving through all of it, and the valley is found through mist
that lifts as the camera settles rather than switched on. A parked canvas
costs nothing per frame; what it costs is memory, so after a showing the scene
is torn down and only built again twelve seconds later. A click before the
warm-up has finished falls back to building on the spot.

**What it costs.** The tier says what the CPU is and nothing about the GPU: a
nine-year-old Radeon behind eight cores reported `high` and ran the first cut
at eight frames a second. Three things fixed that. The hero's canvas is parked
once the valley covers it — it is hidden under the cinematic and the two scenes
together were the bulk of the load — and wakes for the return, so at neither
end is there a frozen frame under the cross-fade. Shadows are plain PCF on every tier that has them. And the
scene times its own frames twice inside the opening, while the mist still hides
what changes, and steps down before the herd is in shot. After the first
window it gives up resolution if it has to, since pixels are most of the cost;
after the second, half the meadow if it is a little short, and the shadows, the
bump and the glow as well if it is well short. Each window is judged by its
median frame, not its mean: a canvas changing resolution stalls for a frame or
two while its buffers are made again, and one such frame in the mean took
everything away from a machine that could run it. The resolution is held in the
canvas's own `dpr` prop, not set with `setDpr` from inside the scene: R3F puts
the prop back on every render of the canvas, the canvas renders on every act,
and for as long as it was done the other way the step-down lasted until the
next act. What the scene settled on is on its canvas as `data-quality`
(`ultra`, `ultra:dpr1`, `high:thin`, `low` and so on).

**Quality.** The CPU tier alone would never have known what the card can do in
the other direction either, so `gpuClass()` reads the renderer string Chrome
and Edge give (Safari and Firefox mostly decline) and `valleyQuality()` puts a
desktop with an Apple M-series or a discrete card on `ultra` — and WebGL drawn
by the CPU (SwiftShader, llvmpipe: a blocklisted driver, a virtual machine, a
CI runner) on `low` whatever the CPU, after the valley was measured there at
under one frame a second on `high`:

| | low | medium | high | ultra |
| --- | --- | --- | --- | --- |
| Resolution | 1× | 1× | up to 1.4× | up to 1.6× |
| Shadows | — | 1024 | 2048 | 4096 |
| Glow | — | — | ✓ | ✓ |
| Blades of grass (16:9) | — | 30 000 | 93 000 | 165 000 |
| Rock relief / cloud deck | — / — | ✓ / — | ✓ / ✓ | ✓ / ✓ |
| Fireball / column / dust sprites | 90 / 460 / 150 | 90 / 460 / 150 | 150 / 640 / 220 | 240 / 960 / 320 |
| Molten sparks | — | 110 | 220 | 360 |
| Flames on the ground / puffs of smoke | — / — | 360 / 220 | 800 / 420 | 1200 / 680 |
| Herd's mesh (tyrannosaur / big ones) | low / low | low / low | medium / medium | high / medium |

`ultra` holds sixty frames a second on an M2 at 1× until the rock lands, and
fifty-five to sixty while the valley burns. Its ceiling used to be 2×, and at
2× the meadow alone is four times the pixels; the opening then ran so slowly
that the step-down took everything away. 1.6× is indistinguishable behind 4×
MSAA and leaves the step-down something to do.

The fire costs little because almost none of it is worked out until it is
needed: no shader asks where the fire is before the rock has landed, and a
leaf, a blade or a patch of ground ahead of the front skips the burn entirely.
What cost most was the crater. Its patch was four times as fine at first, and
from the camera it is a sliver a few hundred pixels across: fifty thousand
triangles of a pixel or less, every one shaded as at least a two-by-two block
— ten frames a second, for fragments nobody saw. It is drawn before the ground
as well, so the pit the ground is lowered into is hidden, not shaded and then
covered.

More sprites change the density, not the look: their alphas are divided by how
many there are, so a column of 960 puffs is as dark as one of 460 and only
smoother. The glow is the 404 page's pass (`glowPass.ts`), laid over the
finished frame: the rock, the plasma, the fireball, the sparks, the fires and
the lightning are drawn again on black into a target a few hundred pixels high,
blurred and added. The ground goes into it too, in black and without fog, so
what burns down in the crater is hidden there as well; fog would have turned it
the colour of the haze and lit the whole glow. The glow dims with the veil of
dust in front of the lens, or halos float over a black screen. The ejected
chunks of crater stay out of it — glowing, they read as a row of small suns.

**After the impact.** Molten droplets go up out of the crater on ballistic arcs,
land, and go on glowing where they land until they cool; the blast front
arriving at the camera, a couple of seconds after the flash, shakes it a second
time and throws dust at the lens; and there is lightning in the column, which is
what a cloud that size full of grit does — three bolts, each a path split again
and again with its midpoints pushed sideways and a few branches off it, drawn as
ribbons facing the camera. A flash lights the sky, the inside of the column and,
for a moment, the dust in front of the lens. The camera is held by hand
throughout: it is never quite still.

**Sound.** Clicking the name opens the valley's sound (`src/features/sound/`, the
same engine as the 404 page with its own bank of voices). The click is the only
gesture there will be, so the `AudioContext` is made inside it — on the press,
in fact, because the first context a page makes costs a couple of hundred
milliseconds while the audio device starts, and made on the click that was a
stall between the click and the valley. A visitor who has turned sound off
anywhere on the site gets the valley without it; the button in the corner
during a showing turns it on and off. The voices are not rendered until the
click: a home page visitor who never asks pays nothing for them, and the worker
renders the bank in the order the timeline needs it, so the ambience is ready
for the opening and the impact long before the rock arrives.

| When | What you hear |
| --- | --- |
| `open`, `graze` | Wind in the ferns, insects trilling in different places, water at the shore; a sauropod's call down the valley, pterosaurs, a stegosaur, a tyrannosaur some way off |
| `streak` | The rock coming in — a rumble that grows until it is everything, the crackle of it breaking up, a falling roar as it goes over — the herd's alarm, and the double crack of the shock wave |
| `impact` | A thud felt more than heard, then nothing but a ringing in the ears while the hearing goes; the blast a beat behind the light |
| `die` | The air arriving with the dust wall, everything it picked up hitting the camera; things coming back down; the animals going over, each as it falls; fire |
| `dark` | Wind over a dead valley; thunder from the lightning, after it — sooner and with a crack when it is close, only the roll when it is far |
| `return` | A chord swelling up under the light, and the insects coming back |

Sound goes at the speed of sound: the blast follows the flash and thunder its
lightning. Animals are panned to where they stand and pushed back by distance —
quieter, duller, more of it the canyon. The sauropod's voice is built the way
the tyrannosaur's is, for a throat about twice as long: its formants are low and
close together, and a phone, which plays nothing much below a few hundred hertz,
still gets them. Cues are fired by the scene's own clock, so a sound lands on
the frame it belongs to; the three loops (the valley's air, the fires and the
wind over the dead valley) are turned up and down by the scene every frame and
remembered by the store for an engine that arrives after it asked.


The timeline runs on a **wall clock**, which is the opposite of everything else
here. The rest of the site accumulates frame deltas so that parking a canvas
pauses a scene rather than rewinding it. A cinematic has a running time: on
hardware that cannot keep up it should play roughly, not stretch to several
minutes, which is exactly what accumulating clamped deltas did. It does wait for
one thing before starting the clock — all five species meshed — because a herd
that turns up during the second act is worse than a beat of empty sky.

### The 404 page

Any address Netlify has no file for gets `dist/404.html`, with a real 404 status
and the same response headers as everything else. It is a page of its own, a
second Vite entry (`404.html` → `src/not-found.tsx`), rather than a route in the
app, because someone who has mistyped an address should not download the whole
site to be told so: up front it is the chunks it shares with the home page and
6 kB of its own, and three.js arrives behind `NotFoundStage`, a three-free gate
like `Companion` and `Valley`. In development it lives at `/404.html`, since
Vite answers every other unknown path with the home page.

The joke is that the page went extinct.

| Seconds | What happens |
| --- | --- |
| 0.3 | A meteor comes in from the top right, past the flat `404` the page has been showing while the renderer loaded |
| 1.3 | It lands: white-out, shockwave, and the flat number is gone. The sky comes up, the ground cracks outward from the impact and the words rise |
| 1.4 | Three digits of basalt columns fly out of the crater and seat themselves, nearest first |
| 2.2 | The tyrannosaur walks in from off screen, the camera and the number both feeling each footfall |
| ~5.5 | It stops, turns, winds up and roars. The rings are drawn at its mouth and the wave goes through the number |
| after | It watches the cursor, turtles swim through the zero, pterosaurs cross the sun, columns let go and grow back, and every so often a meteor comes down by itself |

Clicking anywhere calls a meteor down on that spot and the animal turns to look.
`src/lib/notFound.ts` holds the act and the visitor's requests, `NotFoundScene.tsx`
plays it, `notFoundGlyphs.ts` is the geometry and `notFoundMaterials.ts` the shaders.

**The number is done on the GPU.** Each column carries only its home, radius,
height and four random numbers. Flying out of the crater, seating, rising under
the cursor, leaning away from a shockwave, being thrown clear by a meteor and
dropping off the number are all closed-form in the vertex shader from a handful
of uniforms, so a few thousand columns in motion cost one uniform upload a frame.
Flat shading takes its normals from screen-space derivatives, which is why all of
that is lit correctly with no normal maths at all.

**A column is hot underneath.** The emissive is a function of distance *below the
column's top*, so at rest only the seams glow, and anything that makes a column
stand proud of its neighbours peels the crust away and shows the lava: a wave
going through is visible because of what it uncovers. Under the columns is the
digit's exact outline, extruded and molten, which keeps the silhouette crisp where
the hexagons shrink to fit the ink.

**The digits and the columns come from the same polygons.** `notFoundGlyphs.ts`
is free of three.js and has its own tests: every hexagon stays inside the ink,
the hole in the zero is wide enough for the turtle whose path goes through it.

**Glow is laid over the frame, not baked into it.** The usual post-processing
route tone-maps the whole frame at the end, which turns the light theme's paper
grey and changes the creatures' hides, which were tuned for per-material tone
mapping. So the frame is drawn exactly as on any other canvas, whatever is on
`GLOW_LAYER` is drawn again on black into a small target, blurred down and back
up a short pyramid and added on top. The target has a fixed height rather than a
fraction of the canvas, or the blur is a fixed number of pixels and the glow all
but vanishes on a 5K display; point sprites are scaled down for that pass for the
same reason. The animals are drawn into it in black, or the number shines
straight through them. By day the ash and the flashes stay out of it: added on
top of paper, glow only turns the page yellow.

**The words come first.** They do not wait for the 3D for more than 2.6 s, and
without WebGL, or if the chunk cannot be fetched, the page is the flat number and
the words, with an error boundary to keep it that way: this is what a visitor
sees when something has already gone wrong, and it should not be able to fail too.
`prefers-reduced-motion` gets the finished tableau on a parked canvas, with
nothing to set off.

#### What the tyrannosaur does

The hero's animal only ever walks; this one has a jaw, a will of its own and a
short temper. `notFoundRexActs.ts` holds what each act is, as numbers: how far to
open the mouth, rear up, reach or lift a foot at each moment, and which moments
are events. `NotFoundRex.tsx` blends those over the idle and writes the bones.

| Act | When | What happens |
| --- | --- | --- |
| Roar | On arrival, on the button, after a meteor | Breath in, head up, mouth wide, the wave goes through the number |
| Snap | A cursor near its mouth, or clicking it | Lunges and shuts its jaws on the air |
| Bite | By itself | Walks up to the number (on a phone, reaches from where it stands), tears a piece out, shakes it, chews three times, swallows (a lump goes down the neck) and burps sparks; the wound shows the lava and grows over |
| Tail slam | By itself | Tail up over its back and brought down hard: dust, and the number jumps |
| Stomp | By itself, or poked | Two stamps, the second harder |
| Shake | By itself, or poked | Head thrown about like a dog out of the water |
| Yawn | By itself | Slowly, enormously, eyes shut |
| Sniff | By itself | Head down over the ground, three sniffs and a snort |
| Pace | By itself | Turns on the spot and walks somewhere else for no reason it would admit to |
| Flinch | A meteor lands too close | Recoils, then roars about it |
| Snarl | A small meteor, some way off | A look, and a lifted lip |

Between those it blinks, breathes, pants after anything strenuous, mutters, and
watches the cursor or a passing pterosaur. Clicking on it gets it progressively
less patient rather than calling a meteor down on its head.

The idle list is a fixed order and not dice: chance left the bite for the third
minute, by which time a visitor has gone. Each act is non-interruptible unless
being cut short would look fine, and every act has to end at rest, so the next
one starts without a jolt; `tests/unit/not-found-rex.test.ts` holds them to that.
What a visitor asks for is the exception: a bite and the walk to it take seven
seconds, and someone who has just pressed a button should not have to sit through
that to find out whether it works, so a press or a click cuts in unless what is
going on is nearly over or is already a roar.

**It never turns its back.** The first version walked straight at wherever it was
going, and when that was further into the scene the visitor got a long look at its
rear. Now it stays more or less side-on however it is really moving, turns round by
the side facing the camera even when the other way is shorter, and doesn't turn at
all for a shuffle. Its speed follows its legs and its legs followed the distance
left, so it also used to take for ever over the last stretch; the walk has a floor.

**The jaw had to be split by hand.** Skin weights here come from distance to the
bones, which works for limbs and fails for a mouth: a point on the outside of a
lip is about as far from one jaw as the other, so the lips came down with the jaw
and hid the teeth. The `jaw` bone therefore carries the line of the mouth
(`below` in its spec), everything under that line belongs to it, and everything
above belongs to the skull. At rest none of this changes a vertex, so the hero's
animal and the valley's are untouched by it. The lower teeth ride the jaw.

#### Sound

The 404 page has a voice, and like everything else on the site none of it is a
file. `src/features/sound/voices.ts` writes every sound as arithmetic in a worker,
`engine.ts` is a small mixing desk in Web Audio, and `store.ts` is the only part
in the first download. Each page asks for its own bank of voices (`BANKS`) and the
worker renders only that; the home page's is the extinction cinematic's (see
there). One-shots are cues; ambience is loops the scene turns up and down.

| Sound | How it is made |
| --- | --- |
| Roar, snarl, growl | A source-filter throat: uneven glottal pulses through a bank of resonators, breaking up as the voice strains |
| Footfalls | A sine dropping under the hearing, a knock in the middle for small speakers, then the dirt settling |
| Meteors | Noise through a band climbing all the way to the moment of landing; the buffer is played at whatever speed makes it end on the impact |
| Impacts | A crack, a falling boom, a wall of noise closing from bright to dark, and the debris coming back down in stereo |
| The number | Hundreds of separate stones seating themselves; stone dragging under a moving cursor |
| Pterosaurs, turtles | Raspy falling cries panned across the sky as they cross it; bubbles; a chime when one goes through the zero |
| The place | A seamless 16 s loop of ground, wind, fire and a low beat, lava giving way at random, and a canyon's impulse response for all of it to ring in |

**What makes it sound big is not that it is low.** A listener judges the size of
an animal from its formants: low and close together means a very long throat. The
tyrannosaur's start below 100 Hz, and most of its energy is still deliberately
kept between 300 Hz and 5 kHz, because a phone speaker
plays nothing much below a few hundred hertz and a roar that lives down there is
silence. A clean pulse train through fixed filters sounds like a machine saying a
vowel, so the pulses have jitter, shimmer and period doubling, the pitch is
modulated at the rate of the rattle in the throat, and the formants drift.

**Sound waits for a gesture.** Browsers will not start audio before the visitor
has done something, so the page starts `locked` with a visible invitation, and the
first click anywhere opens it. The `AudioContext` has to be made inside that
click, so it is made by the store, synchronously: a dynamic import would come back
too late to count. The voices are rendered ahead of time so the click can be
answered at once. Turning it off is remembered (`dh.sound`); a hidden tab
suspends it, because the scene stops too.

**A convolver's buffer must be at the context's own sample rate.** Every other
buffer is resampled on playback, so the voices are all rendered at 44.1 kHz, but
`ConvolverNode` throws on a mismatch and most devices run at 48 kHz, so the impulse
response alone is converted on arrival. The cue that fires a roar goes at the start
of the wind-up, because the recording starts with the intake of breath: the voice
arrives as the head comes up.

Ears are the one test nobody has written. `tests/unit/sound-voices.test.ts` checks
that nothing is silent, clipped or discontinuous and that the animal has its
energy where it should, but whether it is frightening is for someone to listen to.

### Canvases and the pointer

Every full-bleed canvas here — the companion's, the valley's — sits in a layer
with `pointer-events: none`, and that is not enough. R3F's `<Canvas>` sets
`pointer-events: auto` on its own wrapper (it is where its event system
listens), which overrides the inherited `none`, so the layer let clicks through
and the canvas inside it did not. The companion's layer is `fixed inset-0` and
is prebuilt a couple of seconds after load, which meant that from then on a
real double-click on the headline landed on a transparent turtle canvas and the
easter egg never opened — while the automated check, which dispatches the event
straight at the element and skips hit-testing, went on passing. Both canvases
now carry `style={{ pointerEvents: 'none' }}` of their own. The universe's
canvas is the one that must not: its meshes take `onClick`.

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

### Overlays and the keyboard

The project dialog and the phone menu are the two things that cover the page,
and both used to be modal in name only: `aria-modal` on the element, and a Tab
key that walked straight out of it into a page that was scroll-locked and half
hidden. `useFocusTrap` holds them now, in two layers, because each covers what
the other cannot:

- **Everything outside is made `inert`.** That is what actually contains
  things — a screen reader's cursor, a click, find-in-page and Tab all stop
  seeing the page — and a key handler alone never achieves it. The hook walks
  down from `<body>`, leaves the overlay's ancestors alone and switches off
  their siblings, so the overlay does not have to be portalled out of the tree.
- **Tab wraps** from the last control to the first. Inert alone lets focus walk
  out into the browser's toolbar, which is how a native modal behaves and not
  what anyone expects of a dialog.

Three details are deliberate:

- The trap takes *several* roots. The phone menu's close button lives in the
  header above it, so the header and the menu stay live together and the loop
  runs through both. For the same reason the menu is no longer `aria-modal`:
  that attribute would tell a screen reader the header is out of reach.
- The project dialog's backdrop is a sibling of the panel, so the root is the
  whole overlay — an inert backdrop would stop taking the click that closes it.
  It is out of the tab order and hidden from assistive technology: a page-sized
  second "close" as the first stop in a dialog is noise for both.
- A trap with nothing mounted does nothing. "Everything outside" an overlay
  that is not there is the whole page, and a hook that can switch the site off
  by accident is worse than no hook.

The menu also closes itself when the window widens past `lg`. It is
`display: none` from there up, and its state used to stay behind: nothing on
screen, the page still scroll-locked — and, once the trap existed, inert.

### Responsive

The layout is fluid rather than stepped: the gutter, the section rhythm and the
display type are all `clamp()`ed, the container is capped at 84rem, and the
hero is `100svh` so a phone's toolbar coming and going does not move it. What
the audit — ten viewports from 360×780 to 2560×1440, each scrolled end to end
and measured for horizontal overflow, boxes crossing the edge, text wider than
its box and targets too small for a thumb — turned up, and what changed:

- The footer's language switcher, in its expanded form, is about 355px wide,
  and the third of a seven-twelfths block never is: because the container is
  capped, even at 1920 it stood out of its column into the gutter, and at 1280
  it stood out of the viewport by 103px. Preferences are now a row under the
  two link columns rather than a third column. The same switcher is 354px wide
  and a 360px phone has 320 to give it, so below the `xs` breakpoint its
  buttons tighten (`max-xs:px-2.5`, 13px type) to 308, and it may wrap as a
  last resort — the only place it does is a 320px screen.
- Targets a thumb can hit. The labels in the universe were 29px tall and the
  technology chips 34; both stay as drawn on a mouse and grow only under a
  coarse pointer (`@media (pointer: coarse)` in CSS, `pointer-coarse:` in
  Tailwind), so the design is unchanged where a cursor is doing the pointing.
- A phone on its side is wide and a few hundred pixels tall, and a headline
  sized from the width alone filled the screen with two words. A `short`
  variant (`landscape` and `max-height: 540px`) sizes the hero from the height
  there and tightens its padding; nothing else sees it.
- The gutter is never narrower than the safe area, so nothing sits under a
  notch in landscape, and the mobile menu pads for the home indicator.
- The hero's canvas used to start 14% in from the left on wide screens, to
  keep the sculpture off the headline. The composition was right; the edge was
  not: anything that orbited out to the left — the turtles, every few seconds —
  vanished at an invisible line a seventh of the way across the page. The
  canvas is now full-bleed and the arrangement itself moves right by the same
  seven percent in world units, so it sits exactly where it did and the orbits
  run to the real edge. The easter egg was unaffected either way: it places the
  animal from the canvas's own bounding rect, not the viewport's.

### Performance

- The entire three.js stack loads lazily; the initial JS payload is React + Motion + app code only (~140 kB, 42 kB gzipped).
- Scenes render only while on screen (`frameloop="never"` off-screen), DPR adapts via `PerformanceMonitor`, and a device-tier estimate (`useDeviceTier`) scales geometry/particles; WebGL-less browsers get a designed 2D fallback.
- `prefers-reduced-motion` disables the preloader, parallax, marquees, sparkles and custom cursor, turns the projects row back into a grid, stops the sky from drifting and its sun and moon from travelling, shows the GitHub numbers and graph already arrived, and changes language at once instead of letter by letter.

## Testing

There were no tests, and the two bugs that reached production in that time have
something in common: neither was visible in the source. The stylesheet said
`backdrop-filter` and the minifier shipped only the prefixed copy, which Chrome
and Firefox ignore; a rule was pasted into the middle of another and half its
declarations were dropped without an error. So the suite is in three layers,
split by *what has to exist* for a check to be possible.

| Layer | Command | Reads | Guards |
| --- | --- | --- | --- |
| Unit | `npm test` | the source | content and links, translations and every line of them turning into every other language letter by letter — and word against word, as a heading does, with the lines it is given on the way — the mesher and every creature, the SEO head, the focus trap, the scroll curves and the universe's flight, the counts and the graph's wave, the long walk's script, land, figures and gaits, the architecture rules |
| Build | `npm run test:dist` | `dist/` | the CSP and its hashes, what loads up front and how big it is, what the minifier did to the CSS |
| Browser | `npm run test:e2e` | `dist/` in Chrome | the page under the production CSP, languages and themes, a change of language shown letter by letter and ending as the page a visit in that language gets, a heading walked there in the words it rose in with its lines moving one way only, the dialog and the menu from the keyboard, the trail, the sky with its sun and moon, the projects row and the marquee as the page scrolls, the GitHub numbers counting to their values and the graph drawing in, the 404 page behind a real 404, the valley's sound (the full showing only where there is a GPU: on CI's software renderer it is over before the test can act) |

**The architecture rules are tests.** `tests/unit/architecture.test.ts` follows
static imports from `main.tsx` and `not-found.tsx` and fails if three.js is reachable without
crossing a dynamic `import()`; does the same for the worker; parses every scene
for a read of `state.clock`; checks each `<Canvas>` for the pointer-events it
needs; and scans the stylesheets for a hand-written prefix or a declaration
stranded inside an `@media`. Every one of those is a rule this README already
states in prose, and every one was learned from a failure that produced no
error — which is exactly the kind a person stops re-checking.

**Every creature is meshed and measured.** No NaN, a watertight surface that
faces outward, one body rather than a body and loose parts, weights that sum to
one, a skeleton that is a single tree, eyes hung on a bone that exists. The
first run found something: the tyrannosaur's nostrils are carved *inside* the
snout. The cut is smaller than the sampling grid and never breaks the surface,
so it comes out as two sealed bubbles in the head rather than two dents on it.
Invisible, and left alone — moving a carve is a change to how the animal looks,
not a fix — but it is why the "one body" test allows a few stray triangles.

**The long walk is walked.** `tests/unit/evolution.test.ts` takes the camera the
whole way in two thousand steps and holds it above the ground and free of
jumps, watches the sun up and down and counts the three nights, follows every
hunter to the water without a step back, checks the land is level where the
walk needs it to be, and — with a skeleton and no renderer — puts every foot of
every gait where the gait says it is, to within a few centimetres. The figures
are held to what they are meant to be as well as to being meshes: a mammoth
whose leg is all but straight when it bears weight, two tusks that mirror each
other and taper to nothing, an eye each side of every head, a coat whose every
lock is rooted on the surface, combed across the way it is wide, weighted to
bones that exist, and shuffled so that half of it is all of it thinned out.
`sdf.test.ts` checks the exact mesher against a sphere, where the answer is
known: every vertex on it to half a thousandth of its radius, no crack where
the triangles are halved, and the grid mesher left bit for bit as it was.

**The browser tests meet the real policy.** `tests/e2e/serve.mjs` serves
`dist/` with the headers from `dist/_headers`; `vite preview` would serve the
same files with no Content-Security-Policy at all, and a policy that blocks the
theme script, the worker or a font does so silently and in production only.
GitHub is mocked at the network layer — the requests still leave the page, so
`connect-src` still has to allow them — which keeps the suite off the
sixty-an-hour limit.

**What is over in a second is watched a frame at a time.** A number counting
to its value and a string turning into its translation both take about a
second, and what has to be checked is what they showed on the way. Watched in
real time that depends on how many frames the machine drew: a laptop draws
sixty, and the CI runner, drawing the page's 3D in software, draws two or
three — the count goes 0, 38, 42, and a test that wanted to see it climb fails
with nothing wrong. Both of the first versions of those tests passed here and
failed there. So they stop the page's clock (`tests/e2e/time.ts`, on
Playwright's `page.clock`) and deal the frames out by hand; every run then sees
the same frames at any speed, and the assertions can be exact — the Uzbek word
is seen in precisely three states, the year lands a year at a time. The one
thing the page's clock does not own is the browser telling the page that
something has scrolled into view, so the count's test deals frames until that
has happened and only then starts counting them. They also run with WebGL
taken away: a frame dealt out is a frame every canvas draws, in software that
is most of a second each, and the first version to deal two hundred of them
took the suite past CI's fifteen minutes. Nothing they watch is 3D, and the
page without WebGL is one the site really serves.

Locally the browser tests drive the Chrome that is already installed, so there
is nothing to download; CI installs Playwright's Chromium. `PW_CHANNEL=chromium`
forces the bundled one.

**`npm run shots` is not a test.** It writes a screenshot of every section, the
long walk in each of its eras, the dialog and the menu — dark and light, desktop and phone — into
`test-results/shots/`, with the device-tier shim described under *The hero
creatures*. It is how a visual change gets looked at before it is called done.

`.github/workflows/ci.yml` runs `npm run verify` step by step on every push and
pull request. It does not gate the Netlify deploy, which builds on its own; to
make it, change the build command in `netlify.toml` to
`npm test && npm run build && npm run test:dist` — the two layers that need no
browser, about five seconds.

One dependency note: `overrides` in `package.json` pins `minimatch` under
`@typescript-eslint/typescript-estree` to a patched release that typescript-eslint
has not moved to yet. When `npm ls minimatch` shows 11.0.1 or later without it,
delete the override.

## Deployment

- Set `VITE_SITE_URL` (see `.env.example`) to the production origin for canonical/OG/hreflang tags.
- The site's own address is resolved once, at build time, by `scripts/site-url.mjs`:
  `VITE_SITE_URL`, else Netlify's `URL`, else `DEPLOY_PRIME_URL`, else
  `https://torexdev.uz`. Vite bakes it into `site.url` through `define` (canonical
  and `og:url`), and `scripts/generate-seo.mjs` rewrites `dist/robots.txt` and
  `dist/sitemap.xml` to match. `public/robots.txt` and `public/sitemap.xml` hold
  the production domain as their template, so a local build is correct as-is.
- That means a deploy advertises the address it is actually served from. Netlify
  sets `URL` to the custom domain once one is attached and to the `.netlify.app`
  address until then, so nothing has to be edited when DNS finally lands — but
  note the domain must exist in the registry first: a site can deploy perfectly
  and still be unreachable, which looks identical to a broken build.
- Static output — any static host works (`dist/`).
- `public/google65ed419aea3368d9.html` is the Google Search Console ownership
  proof for `torexdev.uz`. Vite copies everything in `public/` to the root of
  `dist/`, so it is served at `/google65ed419aea3368d9.html`, which is where
  Google looks. It must keep its exact name and content; `tests/dist` checks
  both. Deleting it unverifies the property.

### Link previews

A link to the site pasted into Telegram used to come out as a bare title: the
Open Graph tags were written by `<Seo>` after React mounted, and the crawlers
that build link previews — Telegram, Instagram, LinkedIn, and most search
engines other than Google — never run JavaScript. A tag that only exists after
hydration does not exist for them.

So `index.html` now carries the whole head for the default language, written
out by hand: canonical and hreflang links, Open Graph and Twitter tags, and the
Person and WebSite structured data. Three things keep that from becoming a
second copy to maintain:

- **The address is filled in at build time.** The tags use `%VITE_SITE_URL%`,
  which Vite replaces from the same `define` that feeds `site.ts` — so a deploy
  preview's `og:image` points at the deploy it is on, like everything else.
- **`<Seo>` adopts the static tags** rather than adding a second set. Each of
  its helpers updates a tag in place if one is there, so switching language
  rewrites the head instead of growing it.
- **A test holds the two to each other.** `tests/unit/seo.test.tsx` loads the
  built head, mounts `<Seo>` in Uzbek and requires the result to be *equal* —
  not to contain the same tags, to be the same head. Add a tag to one side and
  not the other and it fails.

The structured data is two inline `<script type="application/ld+json">` blocks,
and they are deliberately not in the CSP: a data block is never executed, so
`script-src` is never consulted for it, and `scripts/generate-headers.mjs` only
hashes the scripts a browser would run. The browser tests confirm it — the page
loads under the generated policy without a violation.

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
