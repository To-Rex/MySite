import { Suspense, lazy, useEffect, useMemo, useRef } from 'react'
import { useIntroDone } from '@/app/intro'
import { gpuClass, supportsWebGL, useDeviceTier } from '@/hooks/useDeviceTier'
import { useIsMobile, useIsTouch } from '@/hooks/useMediaQuery'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useI18n } from '@/i18n/context'
import { ERAS, captionAt, eraAt, setEvolution, useEvolution, walkProgress, walkScreens } from '@/lib/evolution'
import { useValley, valleyQuality } from '@/lib/valley'
import { useTheme } from '@/theme/context'

/**
 * The long walk: straight after the hero the page stops, and for several
 * screens of scrolling it is one 3D scene — people getting up from a fire and
 * leaving a cave, a hunt, the land settled while the days race, a city putting
 * itself up, and a lit window with somebody at a screen behind it. Then the
 * page carries on from that screen.
 *
 * This file is the gate and must stay free of three.js: it decides whether the
 * scene exists and when it is built, holds the tall element the scroll runs
 * through, and puts the words over the picture. The scene is a lazy chunk.
 *
 * Nothing here re-renders while the page scrolls. One passive listener writes
 * the captions' opacity straight to the DOM, at most once a frame, and the
 * store is only told when something a component reads has changed.
 */
const load = () => import('@/components/three/EvolutionScene')
const EvolutionScene = lazy(load)

/** How far off the window the stage may still be, above or below, when the scene is built, in windows. */
const BUILD_WITHIN = 1.4

/**
 * How long the stage has to have been that close before it is. A jump straight
 * past it — a link in the nav, End, a test — is not a reader arriving, and a
 * scene this size is not something to build for nobody.
 */
const DWELL = 240

/**
 * And how long where WebGL is drawn by the CPU — a blocklisted driver, a
 * virtual machine, a CI runner. Building the scene there is the whole machine
 * for several seconds, so it is built only for someone who has plainly stopped
 * to look, not for someone on their way through.
 */
const DWELL_UNAIDED = 6000

/**
 * And built anyway this long after the intro, even if nobody has scrolled: the
 * stage is the very next thing on the page, and a reader who flicks the wheel
 * would otherwise arrive at an empty one. As soon as the hero's last words are
 * in, which is two and a half seconds; building the scene is then a tenth of a
 * second, the city being built afterwards a set at a time. Not where WebGL is
 * drawn by the CPU, where building it is the whole machine for several seconds.
 */
const PREBUILD = 2600

/**
 * The scene's code is fetched sooner than that, and its people and animals are
 * asked for sooner still: the moment the intro is over, the workers start on
 * the cave and the people by its fire (`evoPrefetch.ts`). They are seconds of
 * arithmetic, off the main thread; asked for only when the scene was built,
 * they came into the cave seconds after the reader did.
 */
const FETCH = 400

export function Evolution() {
  const { t } = useI18n()
  const { theme } = useTheme()
  const reduced = useReducedMotion()
  const tier = useDeviceTier()
  const touch = useIsTouch()
  const narrow = useIsMobile()
  const introDone = useIntroDone()
  const quality = useMemo(() => valleyQuality(tier, gpuClass(), touch), [tier, touch])
  const { near, onScreen } = useEvolution()
  const { act: valley } = useValley()
  const wrapper = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const captions = useRef<(HTMLLIElement | null)[]>([])
  const usable = !reduced && supportsWebGL()

  useEffect(() => {
    if (!usable) return
    let frame = 0
    let dwelling = 0
    const run = () => {
      frame = 0
      const el = wrapper.current
      const pane = stage.current
      if (!el || !pane) return
      const rect = el.getBoundingClientRect()
      const viewport = pane.clientHeight || window.innerHeight
      const progress = walkProgress(rect.top, rect.height, viewport)
      const era = eraAt(progress)
      pane.style.setProperty('--walk', progress.toFixed(4))
      el.dataset.era = era
      ERAS.forEach((name, i) => {
        const caption = captions.current[i]
        if (!caption) return
        const shown = captionAt(name, progress)
        caption.style.opacity = shown.toFixed(3)
        caption.style.transform = `translate3d(0, ${((1 - shown) * 14).toFixed(2)}px, 0)`
        caption.style.visibility = shown > 0.01 ? 'visible' : 'hidden'
      })
      setEvolution({
        onScreen: rect.top < window.innerHeight && rect.bottom > 0,
        pinned: rect.top <= 0 && rect.bottom >= viewport,
        era,
      })
      // Close, and the reader has moved: start counting, and build if it is
      // still close when the count is up.
      const close = rect.top < window.innerHeight * (1 + BUILD_WITHIN) && rect.bottom > -window.innerHeight * BUILD_WITHIN && window.scrollY > window.innerHeight * 0.12
      if (!close) {
        window.clearTimeout(dwelling)
        dwelling = 0
      } else if (!dwelling) {
        dwelling = window.setTimeout(() => setEvolution({ near: true }), gpuClass() === 'software' ? DWELL_UNAIDED : DWELL)
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run)
    }
    run()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(dwelling)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [usable, narrow])

  // Once the intro is out of the way: the meshes, then the chunk, then the
  // scene, once the hero has had the main thread to itself for a moment.
  useEffect(() => {
    if (!usable || !introDone || gpuClass() === 'software') return
    const prefetch = () => void import('@/components/three/evoPrefetch').then((m) => m.prefetchWalk(quality), () => undefined)
    const idle = typeof window.requestIdleCallback === 'function'
    const meshing = idle ? window.requestIdleCallback(prefetch, { timeout: 600 }) : window.setTimeout(prefetch, 200)
    const fetching = window.setTimeout(() => void load(), FETCH)
    const building = window.setTimeout(() => setEvolution({ near: true }), PREBUILD)
    return () => {
      if (idle) window.cancelIdleCallback(meshing)
      else window.clearTimeout(meshing)
      window.clearTimeout(fetching)
      window.clearTimeout(building)
    }
  }, [usable, introDone, quality])

  // A scene that moves the whole view with the scroll is exactly what the
  // reduced-motion preference asks us to leave out, and without WebGL there is
  // nothing to show; either way the page goes straight from the hero to About.
  if (!usable) return null

  return (
    <section
      id="evolution"
      ref={wrapper}
      aria-label={t.evolution.label}
      className="evolution"
      style={{ height: `${walkScreens(narrow) * 100}svh` }}
    >
      <div ref={stage} className="evolution-stage">
        <div className="evolution-scene" aria-hidden>
          {near && (
            <Suspense fallback={null}>
              <EvolutionScene quality={quality} theme={theme} wrapperRef={wrapper} active={onScreen && valley === 'idle'} />
            </Suspense>
          )}
        </div>
        <div className="evolution-veil" aria-hidden />
        <h2 className="sr-only">{t.evolution.title}</h2>
        <ol className="evolution-captions">
          {ERAS.map((era, i) => (
            <li
              key={era}
              ref={(el) => {
                captions.current[i] = el
              }}
              className="evolution-caption"
              data-era={era}
            >
              <p className="evolution-kicker">
                <span aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                {t.evolution.eras[era].label}
              </p>
              <p className="evolution-line">{t.evolution.eras[era].line}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
