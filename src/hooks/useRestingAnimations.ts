import { useEffect } from 'react'

/** How far beyond the screen, above and below, a part of the page stays awake: one screen. */
export const AWAKE_WITHIN = '100% 0px 100% 0px'

/**
 * The page's looping CSS animations rest while the part of the page they are
 * in is more than a screen away from what is shown.
 *
 * The signal bars breathe, the social tiles float, the gallery's hint nudges:
 * dozens of animations that never stop, and the browser works out a frame of
 * every one of them every frame — on the main thread whenever anything there
 * asks where something is, which the long walk does each frame. A section
 * that is more than a screen above or below the one on show is marked
 * `data-asleep`, and the stylesheet holds its animations where they are; they
 * go on from there as it comes back within a screen, long before it is seen.
 * Nothing asleep is on screen, so nothing on screen changes. What is fixed to
 * the screen (the sky, the grain) is never asleep.
 */
export function useRestingAnimations(): void {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const parts = [...document.querySelectorAll<HTMLElement>('#main > section, #main ~ footer')]
    if (parts.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const part = entry.target as HTMLElement
          if (entry.isIntersecting) delete part.dataset.asleep
          else part.dataset.asleep = ''
        }
      },
      { rootMargin: AWAKE_WITHIN },
    )
    for (const part of parts) observer.observe(part)
    return () => {
      observer.disconnect()
      for (const part of parts) delete part.dataset.asleep
    }
  }, [])
}
