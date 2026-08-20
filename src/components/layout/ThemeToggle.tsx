import { AnimatePresence, motion } from 'motion/react'
import { useRef } from 'react'
import { useTheme } from '@/theme/context'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { Moon, Sun } from '@/components/ui/Icons'
import { EASE } from '@/lib/motion'

interface ThemeToggleProps {
  className?: string
  /** Shows the mode name next to the icon. */
  withLabel?: boolean
}

/** Sun ↔ moon toggle. The theme change radiates from the button (View Transitions). */
export function ThemeToggle({ className, withLabel = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()
  const { t } = useI18n()
  const ref = useRef<HTMLButtonElement>(null)
  const isDark = theme === 'dark'
  const label = isDark ? t.a11y.toggleThemeToLight : t.a11y.toggleThemeToDark

  const onClick = () => {
    const r = ref.current?.getBoundingClientRect()
    toggleTheme(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined)
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-cursor="link"
      className={cn(
        'group inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border bg-surface text-fg transition-colors duration-300 hover:bg-surface-hover',
        withLabel ? 'px-4' : 'w-10',
        className,
      )}
    >
      <span className="relative block h-[18px] w-[18px]" aria-hidden>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={theme}
            className="absolute inset-0 flex items-center justify-center"
            initial={{ rotate: -70, scale: 0.4, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 70, scale: 0.4, opacity: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </motion.span>
        </AnimatePresence>
      </span>
      {withLabel && <span className="text-sm font-medium">{isDark ? t.theme.light : t.theme.dark}</span>}
    </button>
  )
}
