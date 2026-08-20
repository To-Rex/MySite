import { AnimatePresence, motion } from 'motion/react'
import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n/context'
import { useTheme } from '@/theme/context'
import { SECTION_IDS } from '@/config/sections'
import { technologies, techGroups } from '@/content/technologies'
import type { TechId } from '@/i18n/types'
import { useDeviceTier, supportsWebGL } from '@/hooks/useDeviceTier'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useInViewport } from '@/hooks/useInViewport'
import { useIsMobile, useIsTouch } from '@/hooks/useMediaQuery'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Reveal } from '@/components/ui/Reveal'
import { ArrowUpRight } from '@/components/ui/Icons'
import { cn } from '@/lib/cn'
import { EASE } from '@/lib/motion'

const UniverseScene = lazy(() => import('@/components/three/UniverseScene'))

/** Static orbital layout used when WebGL is unavailable, on low-tier devices or with reduced motion. */
function UniverseFallback({ activeId, onActivate }: { activeId: TechId | null; onActivate: (id: TechId) => void }) {
  const { t } = useI18n()
  const n = technologies.length
  return (
    <div className="relative aspect-square w-full max-w-[560px] mx-auto">
      <div className="absolute inset-[18%] rounded-full border border-border" aria-hidden />
      <div className="absolute inset-[6%] rounded-full border border-border/60" aria-hidden />
      <div className="absolute inset-[40%] rounded-full bg-gradient-to-br from-surface-2 to-surface ring-1 ring-border" aria-hidden />
      {technologies.map((tech, i) => {
        const ring = tech.core ? 32 : 44
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2
        const x = 50 + Math.cos(angle) * ring
        const y = 50 + Math.sin(angle) * ring
        const active = activeId === tech.id
        return (
          <button
            key={tech.id}
            type="button"
            onClick={() => onActivate(tech.id)}
            aria-pressed={active}
            className={cn('universe-label absolute -translate-x-1/2 -translate-y-1/2', active && 'is-active')}
            style={{ left: `${x}%`, top: `${y}%` }}
            data-active={active}
          >
            <span className="universe-label__dot" aria-hidden />
            {tech.name}
          </button>
        )
      })}
      <span className="sr-only">{t.a11y.techUniverse}</span>
    </div>
  )
}

export function TechUniverse() {
  const { t } = useI18n()
  const { theme } = useTheme()
  const tier = useDeviceTier()
  const reduced = useReducedMotion()
  const isTouch = useIsTouch()
  const isMobile = useIsMobile()
  const stageRef = useRef<HTMLDivElement>(null)
  const inView = useInViewport(stageRef, '200px')
  const [activeId, setActiveId] = useState<TechId | null>(null)

  const use3D = supportsWebGL() && tier !== 'low' && !reduced
  const labels = useMemo(() => Object.fromEntries(technologies.map((x) => [x.id, x.name])) as Record<TechId, string>, [])
  const onActivate = useCallback((id: TechId) => setActiveId(id), [])

  const active = activeId ? technologies.find((x) => x.id === activeId) : undefined
  const activeCopy = activeId ? t.skills.items[activeId] : undefined

  return (
    <section id={SECTION_IDS.skills} aria-labelledby="skills-title" className="section-y relative overflow-hidden">
      <div className="container-x">
        <SectionHeading label={t.skills.label} title={t.skills.title} subtitle={t.skills.subtitle} titleId="skills-title" />

        <div className="mt-12 grid gap-6 lg:mt-16 lg:grid-cols-12 lg:gap-8">
          {/* Stage */}
          <Reveal className="lg:col-span-8" amount={0.15}>
            <div
              ref={stageRef}
              data-cursor={use3D ? 'explore' : undefined}
              className={cn(
                'universe-stage relative overflow-hidden rounded-[2rem] border border-border',
                use3D ? 'aspect-[4/5] sm:aspect-[16/11] lg:aspect-auto lg:min-h-[640px]' : 'p-8 sm:p-12',
              )}
              aria-label={t.a11y.techUniverse}
              role="group"
            >
              {use3D ? (
                <Suspense fallback={null}>
                  <div className="absolute inset-0">
                    <UniverseScene
                      theme={theme}
                      tier={tier}
                      reducedMotion={reduced}
                      active={inView}
                      compact={isMobile}
                      activeId={activeId}
                      onActivate={onActivate}
                      labels={labels}
                    />
                  </div>
                </Suspense>
              ) : (
                <UniverseFallback activeId={activeId} onActivate={onActivate} />
              )}
              <p className="pointer-events-none absolute bottom-5 left-6 font-mono text-[0.66rem] tracking-[0.16em] text-fg-3 uppercase">
                {isTouch ? t.skills.hintTouch : t.skills.hintDesktop}
              </p>
            </div>
          </Reveal>

          {/* Info panel + groups */}
          <div className="flex flex-col gap-6 lg:col-span-4">
            <Reveal delay={0.1} className="relative min-h-[230px] overflow-hidden rounded-[2rem] border border-border bg-surface p-7 md:p-8">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeId ?? 'core'}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.45, ease: EASE }}
                  aria-live="polite"
                >
                  {active && activeCopy ? (
                    <>
                      <span className="eyebrow">{t.skills.groups[active.group]}</span>
                      <h3 className="mt-3 text-[2rem] font-bold tracking-[-0.03em]">{active.name}</h3>
                      <p className="mt-1 text-[0.95rem] font-medium text-accent">{activeCopy.role}</p>
                      <p className="mt-4 text-[1rem] leading-relaxed text-fg-2">{activeCopy.description}</p>
                      <a
                        href={active.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-fg transition-colors hover:text-accent"
                        data-cursor="link"
                      >
                        {active.name}
                        <ArrowUpRight size={14} />
                        <span className="sr-only">({t.common.newTab})</span>
                      </a>
                    </>
                  ) : (
                    <>
                      <span className="eyebrow">{t.skills.core}</span>
                      <h3 className="mt-3 text-[1.6rem] font-bold tracking-[-0.03em] text-balance">{t.common.statement}</h3>
                      <p className="mt-4 text-[1rem] leading-relaxed text-fg-2">{t.skills.subtitle}</p>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </Reveal>

            <Reveal delay={0.18} className="flex flex-col gap-5 rounded-[2rem] border border-border p-7 md:p-8">
              {techGroups.map((group) => (
                <div key={group}>
                  <p className="eyebrow mb-3">{t.skills.groups[group]}</p>
                  <ul className="flex flex-wrap gap-2">
                    {technologies
                      .filter((x) => x.group === group)
                      .map((x) => {
                        const isActive = x.id === activeId
                        return (
                          <li key={x.id}>
                            <button
                              type="button"
                              onClick={() => onActivate(x.id)}
                              onPointerEnter={() => onActivate(x.id)}
                              aria-pressed={isActive}
                              data-cursor="link"
                              className={cn(
                                'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-300',
                                isActive
                                  ? 'border-accent bg-accent text-accent-ink'
                                  : 'border-border text-fg-2 hover:border-border-2 hover:text-fg',
                              )}
                            >
                              {x.name}
                            </button>
                          </li>
                        )
                      })}
                  </ul>
                </div>
              ))}
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  )
}
