import { motion, useMotionValue, useSpring } from 'motion/react'
import { useCallback, useRef, type PointerEvent, type ReactNode } from 'react'
import { useIsFinePointer } from '@/hooks/useMediaQuery'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'

interface MagneticProps {
  children: ReactNode
  className?: string
  /** How strongly the element follows the pointer (0..1). */
  strength?: number
  /** Extra activation radius around the element in px. */
  radius?: number
}

/**
 * Magnetic wrapper: the child drifts toward the pointer while it is nearby and
 * springs back on leave. Disabled on touch devices and with reduced motion.
 */
export function Magnetic({ children, className, strength = 0.3, radius = 24 }: MagneticProps) {
  const ref = useRef<HTMLDivElement>(null)
  const fine = useIsFinePointer()
  const reduced = useReducedMotion()
  const enabled = fine && !reduced

  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 220, damping: 20, mass: 0.6 })
  const sy = useSpring(y, { stiffness: 220, damping: 20, mass: 0.6 })

  const onMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!enabled || !ref.current) return
      const r = ref.current.getBoundingClientRect()
      const dx = e.clientX - (r.left + r.width / 2)
      const dy = e.clientY - (r.top + r.height / 2)
      const inside = Math.abs(dx) < r.width / 2 + radius && Math.abs(dy) < r.height / 2 + radius
      if (inside) {
        x.set(dx * strength)
        y.set(dy * strength)
      } else {
        x.set(0)
        y.set(0)
      }
    },
    [enabled, radius, strength, x, y],
  )

  const reset = useCallback(() => {
    x.set(0)
    y.set(0)
  }, [x, y])

  return (
    <motion.div
      ref={ref}
      className={cn('inline-block', className)}
      style={enabled ? { x: sx, y: sy } : undefined}
      onPointerMove={onMove}
      onPointerLeave={reset}
    >
      {children}
    </motion.div>
  )
}
