import { useI18n } from '@/i18n/context'
import { SECTION_IDS } from '@/config/sections'
import { socials } from '@/content/socials'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Reveal } from '@/components/ui/Reveal'
import { TiltCard } from '@/components/ui/TiltCard'
import { ArrowUpRight, GitHub, Instagram, Telegram } from '@/components/ui/Icons'

const icons = { github: GitHub, instagram: Instagram, telegram: Telegram } as const

/** Digital identity — three floating glass tiles for the platforms where Dilshodjon lives online. */
export function Presence() {
  const { t } = useI18n()

  return (
    <section id={SECTION_IDS.presence} aria-labelledby="presence-title" className="section-y relative overflow-hidden">
      {/* Decorative orbit rings */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
        <div className="h-[120vmin] w-[120vmin] rounded-full border border-border/60" />
        <div className="absolute h-[80vmin] w-[80vmin] rounded-full border border-border/40" />
      </div>

      <div className="container-x relative">
        <SectionHeading label={t.presence.label} title={t.presence.title} subtitle={t.presence.subtitle} titleId="presence-title" align="center" />

        <ul className="mt-16 grid gap-5 md:grid-cols-3" aria-label={t.a11y.socialLinks}>
          {socials.map((s, i) => {
            const Icon = icons[s.id]
            const copy = t.presence.platforms[s.id]
            return (
              <Reveal as="li" key={s.id} delay={0.1 * i} className="float-tile" style={{ animationDelay: `${i * 0.9}s` }}>
                <TiltCard max={9} className="h-full rounded-[2rem]">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-cursor="text"
                    data-cursor-label="open"
                    className="glass group flex h-full min-h-[240px] flex-col justify-between rounded-[2rem] p-7 transition-[border-color,box-shadow] duration-500 hover:border-border-2 hover:shadow-float md:p-8"
                  >
                    <div className="flex items-start justify-between">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-fg ring-1 ring-border">
                        <Icon size={22} />
                      </span>
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-fg-2 transition-[background-color,color,transform] duration-500 ease-[var(--ease-out)] group-hover:rotate-45 group-hover:bg-fg group-hover:text-bg">
                        <ArrowUpRight size={16} />
                      </span>
                    </div>
                    <div>
                      <p className="text-[1.35rem] font-semibold tracking-[-0.02em]">{copy.name}</p>
                      <p className="mt-1 font-mono text-[0.72rem] tracking-[0.1em] text-accent">{s.handle}</p>
                      <p className="mt-3 text-[0.95rem] leading-relaxed text-fg-2">{copy.text}</p>
                    </div>
                    <span className="sr-only">({t.common.newTab})</span>
                  </a>
                </TiltCard>
              </Reveal>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
