import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react'
import { useCallback, useRef, useState } from 'react'
import { useI18n } from '@/i18n/context'
import { site } from '@/config/site'
import { NAV_ITEMS, NAV_SECTION_IDS } from '@/config/sections'
import { useActiveSection } from '@/hooks/useActiveSection'
import { useScrollTo } from '@/hooks/useScrollTo'
import { useIntroDone } from '@/app/intro'
import { cn } from '@/lib/cn'
import { EASE, springSnappy } from '@/lib/motion'
import { startValley } from '@/lib/valley'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeToggle } from './ThemeToggle'
import { MobileMenu } from './MobileMenu'

export function Navigation() {
  const { t } = useI18n()
  const introDone = useIntroDone()
  const scrollTo = useScrollTo()
  const active = useActiveSection(NAV_SECTION_IDS)
  const [hidden, setHidden] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const { scrollY } = useScroll()
  const lastY = useRef(0)

  // Hide on scroll down, reveal on scroll up — the nav never fights the content.
  useMotionValueEvent(scrollY, 'change', (y) => {
    const delta = y - lastY.current
    if (Math.abs(delta) > 6) {
      setHidden(delta > 0 && y > 140 && !menuOpen)
      lastY.current = y
    }
  })

  const toggleMenu = useCallback(() => {
    setMenuOpen((v) => !v)
    setHidden(false)
  }, [])

  const go = useCallback(
    (id: string) => {
      setMenuOpen(false)
      // Let the overlay start closing before the scroll begins.
      window.setTimeout(() => scrollTo(id), menuOpen ? 120 : 0)
    },
    [scrollTo, menuOpen],
  )

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    menuButton.current?.focus()
  }, [])

  return (
    <>
      <motion.header
        initial={{ y: -24, opacity: 0 }}
        animate={introDone ? { y: hidden ? -96 : 0, opacity: 1 } : { y: -24, opacity: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] px-[var(--gutter)] pt-4 md:pt-5"
      >
        <div className="mx-auto flex max-w-[var(--container)] items-center justify-between gap-3">
          {/* Brand monogram */}
          <a
            href="#home"
            onClick={(e) => {
              e.preventDefault()
              go('home')
              // And, for anyone who clicks their own name, the valley.
              startValley()
            }}
            className="glass pointer-events-auto flex h-11 items-center gap-3 rounded-full pr-4 pl-1.5 text-fg"
            aria-label={site.name}
            data-cursor="link"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-fg font-mono text-[0.7rem] font-bold tracking-[0.08em] text-bg">
              {site.monogram}
            </span>
            <span className="hidden text-sm font-semibold tracking-[-0.01em] sm:block">{site.name}</span>
          </a>

          {/* Desktop links */}
          <nav aria-label={t.a11y.mainNav} className="glass pointer-events-auto hidden h-11 items-center rounded-full px-1.5 lg:flex">
            <ul className="flex items-center">
              {NAV_ITEMS.map((item) => {
                const isActive = active === item.id
                return (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      onClick={(e) => {
                        e.preventDefault()
                        go(item.id)
                      }}
                      aria-current={isActive ? 'true' : undefined}
                      data-cursor="link"
                      className={cn(
                        'relative flex h-8 items-center rounded-full px-3.5 text-[0.84rem] font-medium tracking-[-0.005em] transition-colors duration-300',
                        isActive ? 'text-fg' : 'text-fg-2 hover:text-fg',
                      )}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="nav-active"
                          transition={springSnappy}
                          className="absolute inset-0 rounded-full bg-surface-2 ring-1 ring-border"
                          aria-hidden
                        />
                      )}
                      <span className="relative">{t.nav[item.key]}</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* Controls */}
          <div className="pointer-events-auto flex items-center gap-2">
            <div className="glass hidden h-11 items-center rounded-full px-1 lg:flex">
              <LanguageSwitcher />
            </div>
            <ThemeToggle className="glass h-11 w-11" />
            <button
              ref={menuButton}
              type="button"
              onClick={toggleMenu}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? t.a11y.closeMenu : t.a11y.openMenu}
              data-cursor="link"
              className="glass flex h-11 items-center gap-2.5 rounded-full pr-2 pl-4 text-sm font-medium text-fg lg:hidden"
            >
              <span className="relative block h-[1em] overflow-hidden">
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={menuOpen ? 'close' : 'open'}
                    className="block leading-none"
                    initial={{ y: '100%', opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: '-100%', opacity: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                  >
                    {menuOpen ? t.common.close : t.common.menu}
                  </motion.span>
                </AnimatePresence>
              </span>
              <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-surface-2" aria-hidden>
                <motion.span
                  className="absolute h-px w-3 bg-fg"
                  animate={menuOpen ? { rotate: 45, y: 0 } : { rotate: 0, y: -2.5 }}
                  transition={{ duration: 0.4, ease: EASE }}
                />
                <motion.span
                  className="absolute h-px w-3 bg-fg"
                  animate={menuOpen ? { rotate: -45, y: 0 } : { rotate: 0, y: 2.5 }}
                  transition={{ duration: 0.4, ease: EASE }}
                />
              </span>
            </button>
          </div>
        </div>
      </motion.header>

      <MobileMenu open={menuOpen} onClose={closeMenu} onNavigate={go} active={active} />
    </>
  )
}
