import { useI18n } from '@/i18n/context'
import { SECTION_IDS } from '@/config/sections'
import { buildingAreas } from '@/content/building'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Reveal } from '@/components/ui/Reveal'

/** Evolving "now" board — six live areas of exploration with a breathing signal. */
export function Building() {
  const { t } = useI18n()

  return (
    <section id={SECTION_IDS.building} aria-labelledby="building-title" className="section-y relative">
      <div className="container-x">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <SectionHeading label={t.building.label} title={t.building.title} subtitle={t.building.subtitle} titleId="building-title" />
          <Reveal delay={0.2} className="inline-flex items-center gap-3 self-start rounded-full border border-border px-4 py-2 md:self-auto">
            <span className="live-dot" aria-hidden />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase">{t.building.status}</span>
          </Reveal>
        </div>

        <ul className="mt-14 grid gap-px overflow-hidden rounded-[2rem] border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
          {buildingAreas.map((area, i) => {
            const copy = t.building.items[area.id]
            return (
              <Reveal
                as="li"
                key={area.id}
                delay={0.06 * i}
                amount={0.3}
                className="group relative flex h-full flex-col bg-bg p-7 transition-colors duration-500 hover:bg-surface md:p-8"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[0.68rem] tracking-[0.16em] text-fg-3">0{i + 1}</span>
                  <span className="live-dot opacity-70 transition-opacity group-hover:opacity-100" aria-hidden />
                </div>
                <h3 className="mt-8 text-[1.25rem] font-semibold tracking-[-0.02em]">{copy.title}</h3>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-fg-2">{copy.text}</p>
                <div className="mt-8 flex h-10 items-end gap-1" aria-hidden>
                  {area.signal.map((v, j) => (
                    <span
                      key={j}
                      className="signal-bar"
                      style={{ height: `${Math.round(v * 100)}%`, animationDelay: `${j * 120 + i * 90}ms` }}
                    />
                  ))}
                </div>
              </Reveal>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
