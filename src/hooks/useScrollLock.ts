import { useEffect } from 'react'
import { useLenis } from 'lenis/react'

/** Locks page scroll (and Lenis) while `locked` is true — used by overlays. */
export function useScrollLock(locked: boolean) {
  const lenis = useLenis()
  useEffect(() => {
    if (!locked) return
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    lenis?.stop()
    return () => {
      document.documentElement.style.overflow = prev
      lenis?.start()
    }
  }, [locked, lenis])
}
