import { useI18n } from '@/i18n/context'
import { site } from '@/config/site'
import { SECTION_IDS } from '@/config/sections'
import { useCopy } from '@/hooks/useCopy'
import { SplitText } from '@/components/ui/SplitText'
import { Reveal } from '@/components/ui/Reveal'
import { ArrowUpRight, Check, Copy, GitHub, Instagram, Mail, Telegram } from '@/components/ui/Icons'
import { cn } from '@/lib/cn'

export function Contact() {
  const { t } = useI18n()
  const { copied, copy } = useCopy()

  const channels = [
    { id: 'telegram', label: t.contact.channels.telegram, value: site.handles.telegram, href: site.social.telegram, Icon: Telegram, external: true },
    { id: 'instagram', label: t.contact.channels.instagram, value: site.handles.instagram, href: site.social.instagram, Icon: Instagram, external: true },
    { id: 'github', label: t.contact.channels.github, value: site.handles.github, href: site.social.github, Icon: GitHub, external: true },
    { id: 'email', label: t.contact.channels.email, value: site.email, href: `mailto:${site.email}`, Icon: Mail, external: false },
  ] as const

  return (
    <section id={SECTION_IDS.contact} aria-labelledby="contact-title" className="section-y relative overflow-hidden">
      <div className="contact-glow pointer-events-none absolute inset-x-0 bottom-0 h-[70%]" aria-hidden />

      <div className="container-x relative">
        <Reveal className="flex items-center gap-3" y={10}>
          <span className="h-px w-8 bg-accent/80" aria-hidden />
          <span className="eyebrow">{t.contact.label}</span>
        </Reveal>

        <h2 id="contact-title" className="display-tight mt-8 max-w-[12ch] text-[clamp(3rem,11vw,10.5rem)] text-balance">
          <SplitText text={t.contact.title} stagger={0.07} />
        </h2>

        <Reveal delay={0.2} className="mt-8 max-w-[48ch] text-[1.1rem] leading-relaxed text-fg-2 md:text-xl">
          <p>{t.contact.subtitle}</p>
        </Reveal>

        <ul className="mt-16 border-t border-border">
          {channels.map((c, i) => (
            <Reveal as="li" key={c.id} delay={0.06 * i} amount={0.4} className="border-b border-border">
              <div className="group relative flex items-center gap-4 py-5 md:py-6">
                <a
                  href={c.href}
                  {...(c.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  data-cursor="link"
                  className="absolute inset-0 rounded-xl"
                  aria-label={`${c.label} — ${c.value}`}
                />
                <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full border border-border text-fg-2 transition-colors duration-500 group-hover:border-fg group-hover:text-fg">
                  <c.Icon size={20} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                  <span className="text-[1.15rem] font-semibold tracking-[-0.01em] transition-transform duration-500 ease-[var(--ease-out)] group-hover:translate-x-1 md:text-[1.5rem]">
                    {c.label}
                  </span>
                  <span className="truncate font-mono text-[0.78rem] tracking-[0.06em] text-fg-2">{c.value}</span>
                </div>
                {c.id === 'email' ? (
                  <button
                    type="button"
                    onClick={() => copy(site.email)}
                    aria-label={t.a11y.copyEmail}
                    data-cursor="link"
                    className={cn(
                      'relative z-10 inline-flex h-10 flex-none items-center gap-2 rounded-full border px-3.5 text-xs font-medium transition-colors duration-300',
                      copied ? 'border-accent bg-accent text-accent-ink' : 'border-border text-fg-2 hover:border-border-2 hover:text-fg',
                    )}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span className="hidden sm:inline">{copied ? t.contact.copied : t.contact.copy}</span>
                  </button>
                ) : (
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-fg-2 transition-[transform,color] duration-500 ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg">
                    <ArrowUpRight size={18} />
                  </span>
                )}
              </div>
            </Reveal>
          ))}
        </ul>

        <Reveal delay={0.2} className="mt-10 font-mono text-[0.7rem] tracking-[0.16em] text-fg-3 uppercase" y={8}>
          <p>{t.contact.closing}</p>
        </Reveal>
      </div>
    </section>
  )
}
