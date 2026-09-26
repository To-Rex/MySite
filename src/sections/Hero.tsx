import { motion, useScroll, useTransform } from 'motion/react'
import { Suspense, lazy, useRef } from 'react'
import { useI18n } from '@/i18n/context'
import { useTheme } from '@/theme/context'
import { useIntroDone } from '@/app/intro'
import { useDeviceTier, supportsWebGL } from '@/hooks/useDeviceTier'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useInViewport } from '@/hooks/useInViewport'
import { useScrollTo } from '@/hooks/useScrollTo'
import { SECTION_IDS } from '@/config/sections'
import { SplitText } from '@/components/ui/SplitText'
import { Button } from '@/components/ui/Button'
import { ArrowDown } from '@/components/ui/Icons'
import { EASE } from '@/lib/motion'
import { startSpectacle, useSpectacle } from '@/lib/spectacle'
import { useValley } from '@/lib/valley'

const HeroScene = lazy(() => import('@/components/three/HeroScene'))

export function Hero() {
  const { t } = useI18n()
  const { theme } = useTheme()
  const tier = useDeviceTier()
  const reduced = useReducedMotion()
  const introDone = useIntroDone()
  const scrollTo = useScrollTo()
  const ref = useRef<HTMLElement>(null)
  const inView = useInViewport(ref, '160px')

  const { act } = useSpectacle()
  const { act: valley } = useValley()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const textY = useTransform(scrollYProgress, [0, 1], [0, 140])
  const textOpacity = useTransform(scrollYProgress, [0, 0.55], [1, 0])
  const sceneOpacity = useTransform(scrollYProgress, [0.25, 0.9], [1, 0])
  const webgl = supportsWebGL()

  /**
   * The easter egg: double-clicking the name hands it to the tyrannosaur. The
   * letters use the reveal they already have — run backwards to drop them, then
   * forwards, slower, to grow them back out of what the creature leaves behind.
   */
  const eggReady = webgl && !reduced
  // Gone from the moment the animal is summoned until the fruit splits open —
  // and for the whole of the valley, which stands where the words do.
  const buried = valley !== 'idle' && valley !== 'return'
  const nameShown = introDone && (act === 'idle' || act === 'crack' || act === 'return') && !buried
  const growing = act === 'crack' || act === 'return' || valley === 'return'
  const nameMotion = (introDelay: number) =>
    growing
      ? { duration: 1.5, stagger: 0.06, delay: introDelay > 0.5 ? 0.5 : 0.1 }
      : act === 'summon' || valley === 'open'
        ? { duration: 0.5, stagger: 0.026, delay: 0 }
        : { duration: 1.1, stagger: 0.032, delay: introDelay }

  const reveal = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 18 },
    animate: introDone || reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 },
    transition: { duration: 0.9, ease: EASE, delay },
  })

  return (
    <section id={SECTION_IDS.home} ref={ref} aria-labelledby="hero-title" className="relative min-h-[100svh] overflow-hidden">
      {/* Atmosphere */}
      <div className="hero-atmosphere absolute inset-0" aria-hidden />

      {/* 3D identity sculpture */}
      <motion.div
        className="pointer-events-none absolute inset-0 lg:left-[14%]"
        style={{ opacity: sceneOpacity }}
        role="img"
        aria-label={t.a11y.heroSculpture}
      >
        {webgl && (
          <Suspense fallback={null}>
            <HeroScene
              theme={theme}
              tier={tier}
              progress={scrollYProgress}
              introDone={introDone}
              reducedMotion={reduced}
              active={inView}
            />
          </Suspense>
        )}
      </motion.div>

      {/* Content */}
      <motion.div
        style={{ y: textY, opacity: textOpacity }}
        className="container-x relative flex min-h-[100svh] flex-col justify-between pt-28 pb-[clamp(2rem,6vh,4rem)] md:pt-32"
      >
        <motion.div {...reveal(0.2)} className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[0.7rem] tracking-[0.16em] text-fg-2 uppercase">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            {t.hero.eyebrow}
          </span>
          <span className="hidden sm:inline">{t.hero.metaLocation}</span>
          <span className="hidden md:inline">{t.hero.metaProfession}</span>
          <span className="hidden lg:inline">{t.hero.metaSince}</span>
        </motion.div>

        <div className="mt-auto">
          {/* `select-none` because a double-click on text otherwise selects a
              word, and the name is about to be eaten rather than copied. */}
          <h1
            id="hero-title"
            className="display-tight text-[clamp(3.6rem,13.6vw,12.8rem)] uppercase select-none"
            onDoubleClick={eggReady ? () => startSpectacle() : undefined}
          >
            <SplitText
              className="block"
              text={t.hero.firstName}
              mode="chars"
              trigger="manual"
              show={nameShown}
              {...nameMotion(0.35)}
            />
            <SplitText
              className="block text-fg-2"
              text={t.hero.lastName}
              mode="chars"
              trigger="manual"
              show={nameShown}
              {...nameMotion(0.62)}
            />
          </h1>

          <div className="mt-8 grid gap-8 md:mt-10 md:grid-cols-12 md:items-end">
            <div className="md:col-span-7">
              <motion.p {...reveal(1.05)} className="text-[0.95rem] font-semibold tracking-[0.02em] text-accent md:text-base">
                {t.hero.role}
              </motion.p>
              <motion.p {...reveal(1.2)} className="mt-3 max-w-[34ch] text-[1.15rem] leading-snug text-fg-2 md:text-[1.35rem]">
                {t.hero.statement}
              </motion.p>
            </div>
            <motion.div {...reveal(1.35)} className="flex flex-wrap items-center gap-3 md:col-span-5 md:justify-end">
              <Button size="lg" arrow onClick={() => scrollTo(SECTION_IDS.projects)}>
                {t.hero.ctaProjects}
              </Button>
              <Button size="lg" variant="outline" onClick={() => scrollTo(SECTION_IDS.contact)}>
                {t.hero.ctaContact}
              </Button>
            </motion.div>
          </div>

          <motion.button
            {...reveal(1.6)}
            type="button"
            onClick={() => scrollTo(SECTION_IDS.about)}
            className="mt-10 inline-flex items-center gap-3 font-mono text-[0.68rem] tracking-[0.18em] text-fg-3 uppercase transition-colors hover:text-fg"
            data-cursor="link"
            aria-label={t.hero.scrollHint}
          >
            <span className="relative flex h-9 w-5 items-start justify-center rounded-full border border-border-2 p-1" aria-hidden>
              <motion.span
                className="block h-1.5 w-0.5 rounded-full bg-fg-2"
                animate={reduced ? undefined : { y: [0, 14, 0], opacity: [1, 0.2, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              />
            </span>
            {t.hero.scrollHint}
            <ArrowDown size={12} />
          </motion.button>
        </div>
      </motion.div>
    </section>
  )
}
