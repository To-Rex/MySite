import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { SKY, animateAlongPage, starField } from '@/lib/scroll'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useReducedMotion } from '@/hooks/useReducedMotion'

/**
 * The time of day behind the page, set by how far down it the reader is:
 * morning light low under the hero, a clear sky through the middle, an
 * evening glow over the work, and night with stars behind the contact and the
 * footer — the day the valley's cinematic ends, run the other way.
 *
 * Four soft layers under everything, each only ever faded and slid. The
 * browser animates them itself, from the scroll position, where it has scroll
 * timelines; so the page pays nothing per frame for its sky. The tints are
 * light enough that no text loses contrast against them. The stars and the
 * odd meteor are the dark theme's; the light one ends in a dusk.
 */
export function ScrollSky() {
  const dawn = useRef<HTMLDivElement>(null)
  const noon = useRef<HTMLDivElement>(null)
  const dusk = useRef<HTMLDivElement>(null)
  const night = useRef<HTMLDivElement>(null)
  const narrow = useIsMobile()
  const reduced = useReducedMotion()
  const stars = useMemo(() => starField(narrow ? 80 : 160, 11), [narrow])

  useEffect(() => {
    const layers = [
      [dawn.current, SKY.dawn],
      [noon.current, SKY.noon],
      [dusk.current, SKY.dusk],
      [night.current, SKY.night],
    ] as const
    const links = layers.flatMap(([element, stops]) =>
      // With reduced motion the light still changes, but nothing drifts.
      element ? [{ element, stops: reduced ? stops.map((stop) => ({ ...stop, y: 0 })) : stops }] : [],
    )
    return animateAlongPage(links)
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
    </div>
  )
}
