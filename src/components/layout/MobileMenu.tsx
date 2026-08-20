import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useI18n } from '@/i18n/context'
import { NAV_ITEMS } from '@/config/sections'
import { socials } from '@/content/socials'
import { useScrollLock } from '@/hooks/useScrollLock'
import { cn } from '@/lib/cn'
import { EASE } from '@/lib/motion'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeToggle } from './ThemeToggle'
import { ArrowUpRight, GitHub, Instagram, Telegram } from '@/components/ui/Icons'

interface MobileMenuProps {
  open: boolean
  onClose: () => void
  onNavigate: (id: string) => void
  active: string
}

const socialIcon = { github: GitHub, instagram: Instagram, telegram: Telegram } as const

/** Full-screen menu for small screens: large typographic links, preferences and social links. */
export function MobileMenu({ open, onClose, onNavigate, active }: MobileMenuProps) {
  const { t } = useI18n()
  const firstLink = useRef<HTMLAnchorElement>(null)
  useScrollLock(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const id = window.setTimeout(() => firstLink.current?.focus(), 420)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(id)
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          id="mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label={t.common.menu}
          className="fixed inset-0 z-[90] flex flex-col bg-bg/92 px-[var(--gutter)] pt-24 pb-8 backdrop-blur-2xl lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35, ease: EASE } }}
          transition={{ duration: 0.45, ease: EASE }}
        >
          <nav aria-label={t.a11y.mainNav} className="flex-1">
            <ul className="flex flex-col">
              {NAV_ITEMS.map((item, i) => {
                const isActive = active === item.id
                return (
                  <li key={item.id} className="overflow-hidden border-b border-border">
                    <motion.a
                      ref={i === 0 ? firstLink : undefined}
                      href={`#${item.id}`}
                      onClick={(e) => {
                        e.preventDefault()
                        onNavigate(item.id)
                      }}
                      initial={{ y: '100%', opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: '-40%', opacity: 0 }}
                      transition={{ duration: 0.7, ease: EASE, delay: 0.08 + i * 0.05 }}
                      className={cn(
                        'flex items-baseline justify-between py-4 text-[clamp(2rem,8vw,3.2rem)] font-bold tracking-[-0.04em]',
                        isActive ? 'text-fg' : 'text-fg-2',
                      )}
                    >
                      <span>{t.nav[item.key]}</span>
                      <span className="font-mono text-xs tracking-[0.2em] text-fg-3">0{i + 1}</span>
                    </motion.a>
                  </li>
                )
              })}
            </ul>
          </nav>

          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.35 }}
            className="flex flex-col gap-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="eyebrow mb-2">{t.language.label}</p>
                <LanguageSwitcher variant="expanded" layoutId="lang-indicator-menu" />
              </div>
              <div>
                <p className="eyebrow mb-2">{t.theme.label}</p>
                <ThemeToggle withLabel />
              </div>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label={t.a11y.socialLinks}>
              {socials.map((s) => {
                const Icon = socialIcon[s.id]
                return (
                  <li key={s.id}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-medium text-fg-2 hover:text-fg"
                    >
                      <Icon size={16} />
                      {t.presence.platforms[s.id].name}
                      <ArrowUpRight size={14} />
                    </a>
                  </li>
                )
              })}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
