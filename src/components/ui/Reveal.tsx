import { motion, type HTMLMotionProps } from 'motion/react'
import { EASE } from '@/lib/motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'

type RevealTag = 'div' | 'li' | 'article' | 'section' | 'span' | 'p' | 'figure'

type RevealProps = Omit<HTMLMotionProps<'div'>, 'ref'> & {
  as?: RevealTag
  delay?: number
  y?: number
  duration?: number
  amount?: number
  once?: boolean
}

/** Fade-and-rise on scroll. The workhorse reveal for paragraphs, cards and rows. */
export function Reveal({ as = 'div', delay = 0, y = 26, duration = 0.9, amount = 0.2, once = true, children, ...rest }: RevealProps) {
  const reduced = useReducedMotion()
  const Tag = motion[as] as typeof motion.div
  return (
    <Tag
      initial={reduced ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount }}
      transition={{ duration, delay, ease: EASE }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
