import { useEffect, useRef } from 'react'
import { useIsFinePointer } from '@/hooks/useMediaQuery'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useI18n } from '@/i18n/context'
import { pointer } from '@/lib/pointer'

type CursorState = 'default' | 'link' | 'text' | 'drag' | 'explore' | 'hidden'

const INTERACTIVE = 'a, button, [role="button"], input, textarea, select, summary, label'

/**
 * Desktop-only custom cursor: an instant dot plus a lagging ring. Elements opt
 * into states with `data-cursor="link|text|drag|explore"` and an optional
 * `data-cursor-label`. Touch devices never mount this at all.
 */
export function CustomCursor() {
  const fine = useIsFinePointer()
  const reduced = useReducedMotion()
  if (!fine || reduced) return null
  return <CursorLayer />
}

function CursorLayer() {
  const root = useRef<HTMLDivElement>(null)
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const { t } = useI18n()
  const labels = useRef(t.cursor)

  useEffect(() => {
    labels.current = t.cursor
  }, [t])

  useEffect(() => {
    document.documentElement.classList.add('has-custom-cursor')
    const rootEl = root.current
    const dotEl = dot.current
    const ringEl = ring.current
    const labelEl = label.current
    if (!rootEl || !dotEl || !ringEl || !labelEl) return

    let rx = pointer.x
    let ry = pointer.y
    let raf = 0
    let visible = false
    let pressed = false
    let state: CursorState = 'default'

    const setState = (next: CursorState, text = '') => {
      if (state !== next || labelEl.textContent !== text) {
        state = next
        rootEl.dataset.state = next
        labelEl.textContent = text
      }
    }

    const resolve = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : null
      if (!el) return setState('default')
      const tagged = el.closest<HTMLElement>('[data-cursor]')
      if (tagged) {
        const kind = (tagged.dataset.cursor || 'link') as CursorState
        const key = tagged.dataset.cursorLabel as keyof typeof labels.current | undefined
        const text = key ? labels.current[key] ?? '' : ''
        return setState(text ? 'text' : kind, text)
      }
      if (el.closest(INTERACTIVE)) return setState('link')
      setState('default')
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      if (!visible) {
        visible = true
        rx = e.clientX
        ry = e.clientY
        rootEl.style.opacity = '1'
      }
      resolve(e.target)
    }
    const onDown = () => {
      pressed = true
      rootEl.dataset.pressed = 'true'
    }
    const onUp = () => {
      pressed = false
      rootEl.dataset.pressed = 'false'
    }
    const onLeave = () => {
      rootEl.style.opacity = '0'
    }
    const onEnter = () => {
      if (visible) rootEl.style.opacity = '1'
    }

    const tick = () => {
      const tx = pointer.x
      const ty = pointer.y
      rx += (tx - rx) * 0.18
      ry += (ty - ry) * 0.18
      dotEl.style.transform = `translate3d(${tx}px, ${ty}px, 0) translate(-50%, -50%)`
      ringEl.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%) scale(${pressed ? 0.85 : 1})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    document.documentElement.addEventListener('mouseleave', onLeave)
    document.documentElement.addEventListener('mouseenter', onEnter)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      document.documentElement.removeEventListener('mouseenter', onEnter)
      document.documentElement.classList.remove('has-custom-cursor')
    }
  }, [])

  return (
    <div ref={root} className="cursor-root" data-state="default" aria-hidden style={{ opacity: 0 }}>
      <div ref={dot} className="cursor-dot" />
      <div ref={ring} className="cursor-ring">
        <span ref={label} className="cursor-label" />
      </div>
    </div>
  )
}
