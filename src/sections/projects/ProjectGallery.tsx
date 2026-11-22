import { useLenis } from 'lenis/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { projects, type Project } from '@/content/projects'
import { galleryHeight, galleryProgress, galleryScrollFor, nearestIndex } from '@/lib/scroll'
import { ProjectCard } from './ProjectCard'

interface ProjectGalleryProps {
  /** The section's heading, which rides in at the head of the row. */
  intro: ReactNode
  /** The word set huge and hollow behind the row. */
  word: string
  onOpen: (project: Project) => void
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The projects as one long row that the page scroll slides past. The section
 * pins to the screen for exactly as long as the row needs to travel, so a
 * pixel scrolled down is a pixel the row moves left; each card swings to face
 * the reader as it reaches the middle, its cover drifting slower than the card
 * and its numeral faster.
 *
 * The row is a real horizontal scroller, not a strip moved with a transform,
 * and it is kept in step with the page both ways. Vertical scrolling sets its
 * `scrollLeft`; anything that moves it sideways — a trackpad swipe, a thumb,
 * Tab reaching a card off to the right, a test asking for a card to be
 * scrolled into view — moves the page to the matching place. A transformed
 * strip had none of that: the browser cannot scroll a transform to reveal a
 * focused card, so a keyboard walked into cards it could not see.
 */
export function ProjectGallery({ intro, word, onOpen }: ProjectGalleryProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const backdrop = useRef<HTMLSpanElement>(null)
  const hint = useRef<HTMLSpanElement>(null)
  const [current, setCurrent] = useState(0)
  const lenis = useLenis()
  const smooth = useRef(lenis)

  useEffect(() => {
    smooth.current = lenis
  }, [lenis])

  useLayoutEffect(() => {
    const w = wrapper.current
    const st = stage.current
    const sc = scroller.current
    if (!w || !st || !sc) return
    let travel = 0
    let lead = 0
    // The scrollLeft this code last set: a scroll event that finds it changed
    // came from somewhere else.
    let expected = 0
    let frame = 0
    let centers: number[] = []

    const sync = () => {
      frame = 0
      const p = galleryProgress(w.getBoundingClientRect().top, travel, lead)
      const left = p * travel
      if (Math.abs(sc.scrollLeft - left) > 0.5) sc.scrollLeft = left
      expected = sc.scrollLeft
      if (fill.current) fill.current.style.transform = `scaleX(${p.toFixed(4)})`
      if (backdrop.current) backdrop.current.style.transform = `translate3d(${(-p * 38).toFixed(2)}%, -50%, 0)`
      if (hint.current) hint.current.style.opacity = Math.max(0, 1 - p * 14).toFixed(3)
      setCurrent(nearestIndex(centers, sc.scrollLeft + sc.clientWidth / 2))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync)
    }
    const measure = () => {
      travel = Math.max(0, sc.scrollWidth - sc.clientWidth)
      const viewport = st.clientHeight
      // A short hold before the row moves, so the heading lands first, and a
      // longer one at the end, so the last card is not swept off the moment it
      // arrives.
      lead = Math.round(viewport * 0.06)
      w.style.height = `${galleryHeight(viewport, travel, lead, Math.round(viewport * 0.16))}px`
      centers = Array.from(sc.querySelectorAll<HTMLElement>('[data-gallery-card]'), (card) => card.offsetLeft + card.offsetWidth / 2)
      schedule()
    }
    const sideways = () => {
      if (travel <= 0 || Math.abs(sc.scrollLeft - expected) < 2) return
      expected = sc.scrollLeft
      const top = w.getBoundingClientRect().top + window.scrollY
      const y = galleryScrollFor(sc.scrollLeft / travel, top, travel, lead)
      const l = smooth.current
      if (l) l.scrollTo(y, { immediate: true, force: true })
      else window.scrollTo(0, y)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(st)
    observer.observe(sc)
    if (sc.firstElementChild) observer.observe(sc.firstElementChild)
    window.addEventListener('scroll', schedule, { passive: true })
    sc.addEventListener('scroll', sideways, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      sc.removeEventListener('scroll', sideways)
      w.style.height = ''
    }
  }, [])

  return (
    <div ref={wrapper} className="relative" data-gallery>
      <div ref={stage} className="gallery-stage sticky top-0 flex h-[100svh] flex-col justify-center overflow-hidden">
        <span ref={backdrop} className="gallery-word" aria-hidden>
          {word}
        </span>
        {/* Trackpad swipes that are mostly sideways belong to the row, not to Lenis. */}
        <div ref={scroller} className="gallery-scroller" data-lenis-prevent-horizontal>
          <div className="gallery-rail">
            <div className="gallery-intro">{intro}</div>
            <ul className="gallery-list">
              {projects.map((project, i) => (
                <ProjectCard key={project.id} project={project} index={i} onOpen={onOpen} layout="gallery" />
              ))}
            </ul>
          </div>
        </div>
        <div className="container-x gallery-meter" aria-hidden>
          <span className="gallery-meter__count">{pad(current + 1)}</span>
          <span className="gallery-meter__track">
            <span ref={fill} className="gallery-meter__fill" />
          </span>
          <span className="gallery-meter__count text-fg-3">{pad(projects.length)}</span>
          <span ref={hint} className="gallery-meter__hint">
            <svg viewBox="0 0 24 24" width="16" height="16" focusable="false">
              <path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  )
}
