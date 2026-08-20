import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ThemeContext, type Theme, type ThemeContextValue } from './context'
import { storage } from '@/lib/storage'
import { prefersReducedMotion } from '@/hooks/useReducedMotion'

const STORAGE_KEY = 'dh.theme'

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  // index.html already resolved storage/system preference before first paint.
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'light' || attr === 'dark') return attr
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

type DocumentWithVT = Document & {
  startViewTransition?: (cb: () => void) => { ready: Promise<void> }
}

function applyTheme(next: Theme) {
  document.documentElement.setAttribute('data-theme', next)
  document.documentElement.style.colorScheme = next
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme)

  // Follow the OS preference only while the user has not made an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => {
      if (storage.get(STORAGE_KEY)) return
      const next: Theme = e.matches ? 'dark' : 'light'
      applyTheme(next)
      setThemeState(next)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const setTheme = useCallback<ThemeContextValue['setTheme']>((next, origin) => {
    storage.set(STORAGE_KEY, next)
    const doc = document as DocumentWithVT
    const commit = () => {
      applyTheme(next)
      setThemeState(next)
    }

    // Cinematic circular reveal via the View Transitions API when available.
    if (!doc.startViewTransition || prefersReducedMotion()) {
      commit()
      return
    }
    const x = origin?.x ?? window.innerWidth / 2
    const y = origin?.y ?? window.innerHeight / 2
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const transition = doc.startViewTransition(() => flushSync(commit))
    transition.ready
      .then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 720, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
        )
      })
      .catch(() => {
        /* transition skipped — theme is already applied */
      })
  }, [])

  const toggleTheme = useCallback<ThemeContextValue['toggleTheme']>(
    (origin) => setTheme(theme === 'dark' ? 'light' : 'dark', origin),
    [setTheme, theme],
  )

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
