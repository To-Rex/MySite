import { motion, useMotionTemplate, useMotionValue, useSpring } from 'motion/react'
import { useCallback, useRef, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useIsFinePointer } from '@/hooks/useMediaQuery'
import { useReducedMotion } from '@/hooks/useReducedMotion'

interface TiltCardProps {
  children: ReactNode
  className?: string
  /** Max tilt in degrees. */
  max?: number
  /** Renders a pointer-following highlight. */
  glare?: boolean
}

/** Pointer-driven 3D tilt with springs and a soft pointer glare. Touch devices get a flat card. */
export function TiltCard({ children, className, max = 7, glare = true }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const fine = useIsFinePointer()
  const reduced = useReducedMotion()
  const enabled = fine && !reduced

  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const gx = useMotionValue(50)
  const gy = useMotionValue(50)
  const srx = useSpring(rx, { stiffness: 200, damping: 22 })
  const sry = useSpring(ry, { stiffness: 200, damping: 22 })
  const glareBg = useMotionTemplate`radial-gradient(420px circle at ${gx}% ${gy}%, var(--glow), transparent 60%)`

  const onMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!enabled || !ref.current) return
      const r = ref.current.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width
      const py = (e.clientY - r.top) / r.height
      ry.set((px - 0.5) * max * 2)
      rx.set(-(py - 0.5) * max * 2)
      gx.set(px * 100)
      gy.set(py * 100)
    },
    [enabled, max, rx, ry, gx, gy],
  )

  const onLeave = useCallback(() => {
    rx.set(0)
    ry.set(0)
  }, [rx, ry])

  return (
    <motion.div
      ref={ref}
      className={cn('group relative [transform-style:preserve-3d] will-change-transform', className)}
      style={enabled ? { rotateX: srx, rotateY: sry, transformPerspective: 1100 } : undefined}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {children}
      {glare && enabled && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{ background: glareBg }}
        />
      )}
    </motion.div>
  )
}
