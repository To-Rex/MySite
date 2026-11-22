import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { createMarquee, marqueeCopies, stepMarquee } from '@/lib/scroll'

interface MarqueeProps {
  items: readonly string[]
  className?: string
}

/** A four-pointed spark between the words; it rolls as the row moves. */
function Spark() {
  return (
    <svg className="marquee-spark" viewBox="0 0 24 24" focusable="false">
      <path d="M12 0c.9 6.3 5.1 10.5 12 12-6.9 1.5-11.1 5.7-12 12-.9-6.3-5.1-10.5-12-12C6.9 10.5 11.1 6.3 12 0Z" />
    </svg>
  )
}

/**
 * A ticker that answers the scroll. It drifts left; scrolling down drives it
 * faster, the faster the page goes; scrolling up turns it round; it leans into
 * its own speed and eases back to the drift when the page stops. Under the
 * pointer it all but stops, so the words can be read. With reduced motion it
 * is a still row, and off screen it does no work at all.
 *
 * The page's scroll is read from `window.scrollY` in its own frame loop, like
 * the companion's, rather than through a motion value: one number a frame,
 * clamped and checked, with nothing upstream that can hand it a NaN.
 */
export function Marquee({ items, className }: MarqueeProps) {
  const reduced = useReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const period = useRef(0)
  const [copies, setCopies] = useState(2)

  // One copy of the row is the period it wraps at; enough copies to cover the
  // widest screen keep the far end from ever showing.
  useEffect(() => {
    const el = root.current
    const row = track.current?.firstElementChild
    if (!el || !(row instanceof HTMLElement)) return
    const measure = () => {
      period.current = row.offsetWidth
      setCopies(marqueeCopies(el.clientWidth, row.offsetWidth))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observer.observe(row)
    return () => observer.disconnect()
  }, [items])

  useEffect(() => {
    const el = root.current
    const tr = track.current
    if (reduced || !el || !tr) return
    const motion = createMarquee()
    let frame = 0
    let last = 0
    let lastY = 0
    let visible = false
    let hovered = false
    let direction = 0

    const tick = (now: number) => {
      frame = 0
      const y = window.scrollY
      stepMarquee(motion, (now - last) / 1000, y - lastY, period.current, hovered)
      last = now
      lastY = y
      // Shear depends only on height, so leaning the whole row leans every word
      // the same — one composited transform instead of one per word.
      tr.style.transform = `translate3d(${(-motion.offset).toFixed(2)}px, 0, 0) skewX(${motion.skew.toFixed(2)}deg)`
      tr.style.setProperty('--spin', `${(motion.travel * 0.5).toFixed(1)}deg`)
      if (motion.direction !== direction) {
        direction = motion.direction
        el.dataset.direction = direction > 0 ? 'left' : 'right'
      }
      if (visible) frame = requestAnimationFrame(tick)
    }
    const start = () => {
      if (frame) return
      last = performance.now()
      lastY = window.scrollY
      frame = requestAnimationFrame(tick)
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting
        if (visible) start()
      },
      { rootMargin: '120px 0px' },
    )
    observer.observe(el)
    const enter = () => {
      hovered = true
    }
    const leave = () => {
      hovered = false
    }
    el.addEventListener('pointerenter', enter)
    el.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointerleave', leave)
      tr.style.transform = ''
    }
  }, [reduced])

  return (
    // Left out of the letter-by-letter change of language: nobody reads a running row a letter
    // at a time, and every width it passed through on the way would be measured as a new row.
    <div ref={root} className={cn('marquee mask-fade-x overflow-hidden', className)} aria-hidden data-direction="left" data-no-morph>
      <div ref={track} className="marquee-track">
        {Array.from({ length: copies }, (_, copy) => (
          <div key={copy} className="marquee-row flex flex-none items-center gap-10 pr-10">
            {items.map((item, i) => (
              <span
                key={`${item}-${i}`}
                className="flex items-center gap-10 text-[clamp(1rem,1.6vw,1.25rem)] font-medium tracking-[-0.01em] whitespace-nowrap text-fg-2"
              >
                {item}
                <Spark />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
