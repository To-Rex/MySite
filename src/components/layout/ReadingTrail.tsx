import { useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { followPageProgress, printsDown, trailCount, trailPrints } from '@/lib/scroll'

const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}
const countNow = () => trailCount(window.innerWidth)

/**
 * One theropod print in a 24-unit box, walking right: a broad pad and three
 * thick, clawed toes, the inner one shorter. Separate shapes, so where they
 * overlap they add up instead of cancelling into a hole. Left feet are this
 * mirrored.
 */
const PRINT = [
  'M2.7 12a3.9 3.6 0 1 0 7.8 0a3.9 3.6 0 1 0-7.8 0Z',
  'M7 9.9C11.8 9.6 16.6 10.3 20.2 11.1L23.2 12L20.2 12.9C16.6 13.7 11.8 14.4 7 14.1Z',
  'M9.4 12C12.4 14 15.2 16.8 17.47 19.3L18.68 21.46L16.27 20.9C13.6 19.1 10.4 17.1 7 15.2Z',
  'M9.34 11.92C12.2 10.2 14.6 7.6 16.47 5.38L17.52 3.41L15.33 3.86C13.2 5.9 10.4 7.6 7.06 8.88Z',
]

/**
 * How far down the page the reader is, as a tyrannosaur's trackway along the
 * top edge of the screen: a print lands for every stretch read, pressed in
 * with a little give, and the trail lifts again print by print on the way
 * back up. The newest print is fresh and in the accent; older ones dry out.
 *
 * It sits above the floating nav, in the band the nav leaves clear, so it is
 * there whether the nav is shown or tucked away — which is when a reader
 * going down actually wants it. Its own layer, nothing to click, nothing a
 * screen reader needs to hear.
 */
export function ReadingTrail() {
  const ref = useRef<HTMLDivElement>(null)
  const count = useSyncExternalStore(subscribe, countNow, () => 0)
  const prints = useMemo(() => trailPrints(count), [count])

  useEffect(() => {
    const el = ref.current
    if (!el || count === 0) return
    // Written only when a print lands or lifts — a few dozen times down the
    // whole page — and the transitions on each print do the animating.
    let shown = -1
    return followPageProgress((progress) => {
      const down = printsDown(progress, count)
      if (down === shown) return
      shown = down
      el.style.setProperty('--down', String(down))
      el.dataset.down = String(down)
    })
  }, [count])

  return (
    <div ref={ref} className="reading-trail" aria-hidden data-prints={count}>
      <svg className="reading-trail__defs" width="0" height="0" focusable="false">
        <symbol id="theropod-print" viewBox="0 0 24 24">
          {PRINT.map((d) => (
            <path key={d} d={d} />
          ))}
        </symbol>
      </svg>
      {prints.map((print) => (
        <span
          key={print.i}
          className="reading-trail__print"
          style={
            {
              '--i': print.i,
              '--y': `${print.y}px`,
              '--r': `${print.rotate}deg`,
              '--s': print.scale,
              '--m': print.left ? -1 : 1,
              left: `${print.x}%`,
            } as CSSProperties
          }
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <use href="#theropod-print" />
          </svg>
        </span>
      ))}
    </div>
  )
}
