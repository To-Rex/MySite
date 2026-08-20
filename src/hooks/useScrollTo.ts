import { useCallback } from 'react'
import { useLenis } from 'lenis/react'
import { prefersReducedMotion } from './useReducedMotion'

/** Smoothly scrolls to a section id via Lenis (or natively when Lenis is absent/reduced motion). */
export function useScrollTo() {
  const lenis = useLenis()
  return useCallback(
    (id: string) => {
      const target = document.getElementById(id)
      if (!target) return
      if (lenis && !prefersReducedMotion()) {
        lenis.scrollTo(target, { duration: 1.4, easing: (x) => 1 - Math.pow(1 - x, 4) })
      } else {
        target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
      }
      if (history.replaceState) history.replaceState(null, '', `#${id}`)
    },
    [lenis],
  )
}
