import { Suspense, lazy, useEffect, useState } from 'react'
import { useTheme } from '@/theme/context'
import { useDeviceTier, supportsWebGL } from '@/hooks/useDeviceTier'
import { useReducedMotion } from '@/hooks/useReducedMotion'

/**
 * Decides *whether* the scroll companion exists; the turtle itself lives in a
 * lazily imported chunk. This file must stay free of three.js imports — pulling
 * them in here would drag the whole renderer into the entry bundle and undo the
 * site's lazy-3D loading.
 */
const CompanionTurtle = lazy(() => import('./CompanionTurtle'))

export function Companion() {
  const { theme } = useTheme()
  const tier = useDeviceTier()
  const reduced = useReducedMotion()
  // Mounted once the hero has been left behind and kept mounted after that:
  // tearing a WebGL context down and rebuilding it on every scroll reversal
  // costs far more than leaving one idle canvas in place.
  const [awake, setAwake] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (reduced) return
    const onScroll = () => {
      const past = window.scrollY > window.innerHeight * 0.55
      setVisible(past)
      if (past) setAwake(true)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [reduced])

  // A creature that chases the reader is exactly the motion this preference asks
  // us to drop, so it never appears at all.
  if (reduced || !awake || !supportsWebGL()) return null

  return (
    <Suspense fallback={null}>
      <CompanionTurtle theme={theme} tier={tier} visible={visible} />
    </Suspense>
  )
}
