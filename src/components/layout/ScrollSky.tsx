import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { DAY, MOON, SKY, SUN, animateAlongPage, arcStillStops, arcStops, arcTintStops, starField, type Stop } from '@/lib/scroll'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useReducedMotion } from '@/hooks/useReducedMotion'

/**
 * The time of day behind the page, set by how far down it the reader is:
 * morning light low under the hero, a clear sky through the middle, an
 * evening glow over the work, and night with stars behind the contact and the
 * footer — the day the valley's cinematic ends, run the other way.
 *
 * Four soft layers under everything, each only ever faded and slid, and over
 * them the two things that say what time it is: a sun that comes up as the
 * page is first moved, crosses the top of the screen and goes down into the
 * dusk, and a moon that is up by the time the stars are. The browser animates
 * all of it itself, from the scroll position, where it has scroll timelines;
 * so the page pays nothing per frame for its sky. The tints are light enough
 * that no text loses contrast against them, and so are the discs. The stars
 * and the odd meteor are the dark theme's; the light one ends in a dusk, with
 * a pale moon in it.
 */
export function ScrollSky() {
  const dawn = useRef<HTMLDivElement>(null)
  const noon = useRef<HTMLDivElement>(null)
  const dusk = useRef<HTMLDivElement>(null)
  const night = useRef<HTMLDivElement>(null)
  const sun = useRef<HTMLDivElement>(null)
  const sunHigh = useRef<HTMLElement>(null)
  const sunLow = useRef<HTMLElement>(null)
  const moon = useRef<HTMLDivElement>(null)
  const narrow = useIsMobile()
  const reduced = useReducedMotion()
  const stars = useMemo(() => starField(narrow ? 80 : 160, 11), [narrow])

  useEffect(() => {
    const still = (stops: readonly Stop[]) => stops.map((stop) => ({ ...stop, y: 0 }))
    const shown: readonly Stop[] = [{ at: 0, opacity: 1 }]
    const hidden: readonly Stop[] = [{ at: 0, opacity: 0 }]
    // With reduced motion the light still changes, but nothing drifts and
    // nothing travels: the sun and the moon come and go where they hang.
    const curves: readonly (readonly [HTMLElement | null, readonly Stop[]])[] = [
      [dawn.current, reduced ? still(SKY.dawn) : SKY.dawn],
      [noon.current, reduced ? still(SKY.noon) : SKY.noon],
      [dusk.current, reduced ? still(SKY.dusk) : SKY.dusk],
      [night.current, reduced ? still(SKY.night) : SKY.night],
      [sun.current, reduced ? arcStillStops(SUN) : arcStops(SUN)],
      [sunHigh.current, reduced ? shown : arcTintStops(SUN, 'high')],
      [sunLow.current, reduced ? hidden : arcTintStops(SUN, 'low')],
      [moon.current, reduced ? arcStillStops(MOON) : arcStops(MOON)],
    ]
    return animateAlongPage(
      curves.flatMap(([element, stops]) => (element ? [{ element, stops }] : [])),
      DAY,
    )
  }, [reduced])

  return (
    <div className="scroll-sky" aria-hidden>
      <div ref={dawn} className="scroll-sky__layer scroll-sky__dawn" />
      <div ref={noon} className="scroll-sky__layer scroll-sky__noon" />
      <div ref={dusk} className="scroll-sky__layer scroll-sky__dusk" />
      <div ref={night} className="scroll-sky__layer scroll-sky__night">
        <svg className="scroll-sky__stars" width="100%" height="100%" focusable="false">
          {stars
            .filter((star) => !star.twinkle)
            .map((star, i) => (
              <circle key={i} cx={`${star.x}%`} cy={`${star.y}%`} r={star.r} fillOpacity={star.a} />
            ))}
        </svg>
        {stars
          .filter((star) => star.twinkle)
          .map((star, i) => (
            <i
              key={i}
              className="scroll-sky__twinkle"
              style={{ left: `${star.x}%`, top: `${star.y}%`, '--size': `${(star.r * 2.4).toFixed(2)}px`, '--d': `${star.delay}s`, '--t': `${star.period}s` } as CSSProperties}
            />
          ))}
        <i className="scroll-sky__meteor" />
      </div>
      <div ref={sun} className="scroll-sky__orb scroll-sky__sun">
        <i ref={sunHigh} className="scroll-sky__disc scroll-sky__disc--high" />
        <i ref={sunLow} className="scroll-sky__disc scroll-sky__disc--low" />
      </div>
      <div ref={moon} className="scroll-sky__orb scroll-sky__moon">
        <i className="scroll-sky__disc scroll-sky__disc--moon" />
      </div>
    </div>
  )
}
