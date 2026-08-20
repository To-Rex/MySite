import { useI18n } from '@/i18n/context'
import { SECTION_IDS } from '@/config/sections'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Reveal } from '@/components/ui/Reveal'
import { Marquee } from '@/components/ui/Marquee'
import { cn } from '@/lib/cn'

export function About() {
  const { t } = useI18n()
  const facts = [t.about.facts.born, t.about.facts.profession, t.about.facts.education, t.about.facts.location]

  return (
    <section id={SECTION_IDS.about} aria-labelledby="about-title" className="section-y relative">
      <div className="container-x">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-10">
          {/* Left: heading + facts */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-32">
              <SectionHeading label={t.about.label} title={t.about.title} titleId="about-title" />
              <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8">
                {facts.map((fact, i) => (
                  <Reveal key={fact.label} delay={0.08 * i} className="border-t border-border pt-4">
                    <dt className="eyebrow">{fact.label}</dt>
                    <dd className="mt-2 text-[0.98rem] leading-snug font-medium text-fg">{fact.value}</dd>
                  </Reveal>
                ))}
              </dl>
            </div>
          </div>

          {/* Right: story + principles */}
          <div className="lg:col-span-7 lg:pt-2">
            <div className="flex flex-col gap-6">
              {t.about.paragraphs.map((p, i) => (
                <Reveal key={i} delay={0.05 * i}>
                  <p
                    className={cn(
                      'leading-relaxed text-pretty',
                      i === 0 ? 'text-[1.3rem] font-medium text-fg md:text-[1.6rem] md:leading-snug' : 'text-[1.05rem] text-fg-2 md:text-lg',
                    )}
                  >
                    {p}
                  </p>
                </Reveal>
              ))}
            </div>

            <Reveal className="mt-16 flex items-center gap-3" y={10}>
              <span className="h-px w-8 bg-accent/80" aria-hidden />
              <h3 className="eyebrow">{t.about.principlesTitle}</h3>
            </Reveal>
            <ul className="mt-6 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2">
              {t.about.principles.map((p, i) => (
                <Reveal
                  as="li"
                  key={p.title}
                  delay={0.06 * i}
                  amount={0.3}
                  className="group h-full bg-bg p-6 transition-colors duration-500 hover:bg-surface md:p-7"
                >
                  <span className="font-mono text-[0.68rem] tracking-[0.16em] text-fg-3">0{i + 1}</span>
                  <h4 className="mt-5 text-[1.05rem] font-semibold tracking-[-0.01em]">{p.title}</h4>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-fg-2">{p.text}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <Marquee items={t.about.marquee} className="mt-24 border-y border-border py-5 md:mt-32" />
    </section>
  )
}
