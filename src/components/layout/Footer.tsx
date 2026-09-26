import { useI18n } from '@/i18n/context'
import { site } from '@/config/site'
import { NAV_ITEMS } from '@/config/sections'
import { socials } from '@/content/socials'
import { useScrollTo } from '@/hooks/useScrollTo'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeToggle } from './ThemeToggle'
import { ArrowUp, ArrowUpRight } from '@/components/ui/Icons'
import { Magnetic } from '@/components/ui/Magnetic'

export function Footer() {
  const { t } = useI18n()
  const scrollTo = useScrollTo()
  const year = new Date().getFullYear()

  return (
    <footer className="relative border-t border-border">
      <div className="container-x py-14 md:py-20">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <a
              href="#home"
              onClick={(e) => {
                e.preventDefault()
                scrollTo('home')
              }}
              className="inline-flex items-center gap-3"
              data-cursor="link"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-fg font-mono text-[0.75rem] font-bold tracking-[0.08em] text-bg">
                {site.monogram}
              </span>
              <span className="text-base font-semibold tracking-[-0.01em]">{site.name}</span>
            </a>
            <p className="mt-5 max-w-[34ch] text-[1.05rem] leading-relaxed text-fg-2">{t.footer.tagline}</p>
            <p className="mt-3 font-mono text-xs tracking-[0.14em] text-fg-3 uppercase">{t.common.role}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 md:col-span-7">
            <div>
              <p className="eyebrow mb-4">{t.footer.nav}</p>
              <ul className="flex flex-col gap-2.5">
                {NAV_ITEMS.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      onClick={(e) => {
                        e.preventDefault()
                        scrollTo(item.id)
                      }}
                      className="inline-block text-sm text-fg-2 transition-colors hover:text-fg pointer-coarse:py-1.5"
                      data-cursor="link"
                    >
                      {t.nav[item.key]}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="eyebrow mb-4">{t.footer.connect}</p>
              <ul className="flex flex-col gap-2.5">
                {socials.map((s) => (
                  <li key={s.id}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-fg-2 transition-colors hover:text-fg pointer-coarse:py-1.5"
                      data-cursor="link"
                    >
                      {t.presence.platforms[s.id].name}
                      <ArrowUpRight size={13} />
                    </a>
                  </li>
                ))}
                <li>
                  <a href={`mailto:${site.email}`} className="inline-block text-sm text-fg-2 transition-colors hover:text-fg pointer-coarse:py-1.5" data-cursor="link">
                    {site.email}
                  </a>
                </li>
              </ul>
            </div>
            <div className="col-span-2">
              <p className="eyebrow mb-4">{t.footer.preferences}</p>
              <div className="flex flex-wrap items-center gap-3">
                <LanguageSwitcher variant="expanded" layoutId="lang-indicator-footer" />
                <ThemeToggle withLabel />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-14 flex flex-col-reverse items-start justify-between gap-6 border-t border-border pt-6 sm:flex-row sm:items-center">
          <p className="font-mono text-[0.7rem] tracking-[0.12em] text-fg-3 uppercase">
            © {year} {site.name}. {t.footer.rights}
          </p>
          <Magnetic>
            <button
              type="button"
              onClick={() => scrollTo('home')}
              aria-label={t.a11y.backToTop}
              data-cursor="link"
              className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-fg-2 transition-colors hover:border-border-2 hover:text-fg"
            >
              {t.footer.top}
              <ArrowUp size={16} />
            </button>
          </Magnetic>
        </div>
      </div>
    </footer>
  )
}
