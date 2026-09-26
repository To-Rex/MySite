import { motion } from 'motion/react'
import { LANGUAGES, type Language } from '@/i18n/types'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { springSnappy } from '@/lib/motion'

interface LanguageSwitcherProps {
  /** `compact` renders UZ · EN · DE · RU; `expanded` shows full language names. */
  variant?: 'compact' | 'expanded'
  className?: string
  layoutId?: string
}

export function LanguageSwitcher({ variant = 'compact', className, layoutId = 'lang-indicator' }: LanguageSwitcherProps) {
  const { lang, setLang, t } = useI18n()

  return (
    <div
      role="group"
      aria-label={t.a11y.languageSwitcher}
      className={cn(
        'relative inline-flex items-center rounded-full p-1',
        variant === 'compact' ? 'gap-0.5' : 'max-w-full flex-wrap justify-center gap-1 border border-border bg-surface',
        className,
      )}
    >
      {LANGUAGES.map((code: Language) => {
        const active = code === lang
        return (
          <button
            key={code}
            type="button"
            lang={code}
            onClick={() => setLang(code)}
            aria-pressed={active}
            aria-label={t.language.names[code]}
            data-cursor="link"
            className={cn(
              'relative rounded-full font-medium transition-colors duration-300',
              variant === 'compact' ? 'h-8 px-2.5 font-mono text-[0.7rem] tracking-[0.12em] uppercase' : 'h-10 px-4 text-sm max-xs:px-2.5 max-xs:text-[0.82rem]',
              active ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={springSnappy}
                className="absolute inset-0 rounded-full bg-surface-2 ring-1 ring-border"
                aria-hidden
              />
            )}
            <span className="relative">{variant === 'compact' ? code : t.language.names[code]}</span>
          </button>
        )
      })}
    </div>
  )
}
