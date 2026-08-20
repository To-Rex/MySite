import type { Transition } from 'motion/react'

/** The one easing curve used everywhere — calm, controlled, expensive-feeling. */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

/** Shared spring for active-pill indicators (nav, language switcher). */
export const springSnappy: Transition = { type: 'spring', stiffness: 420, damping: 34 }
