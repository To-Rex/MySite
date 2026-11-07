import { useEffect, useRef } from 'react'

type Roots = readonly (HTMLElement | null | undefined)[]

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
].join(',')

/**
 * Everything inside `root` the Tab key would stop at, in document order.
 *
 * `getClientRects` rather than a style lookup: it is empty for anything not
 * rendered at all, whichever ancestor hid it — which is how the desktop-only
 * language switcher in the header drops out of the mobile menu's loop.
 */
function tabbable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length > 0,
  )
}

/**
 * Makes everything outside `roots` inert and returns the undo.
 *
 * Walks down from <body>: a root is left alone with its whole subtree, an
 * ancestor of a root is descended into, and anything else is switched off. So
 * the overlay does not have to be portalled out of the tree to stand alone —
 * it stays where React put it and the page around it goes quiet.
 */
function silenceOutside(roots: HTMLElement[]): () => void {
  const path = new Set<Element>()
  for (const root of roots) {
    for (let el = root.parentElement; el && el !== document.body; el = el.parentElement) path.add(el)
  }
  const silenced: HTMLElement[] = []
  const visit = (parent: Element) => {
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement) || roots.includes(child)) continue
      if (path.has(child)) visit(child)
      else if (!child.inert) {
        child.inert = true
        silenced.push(child)
      }
    }
  }
  visit(document.body)
  return () => {
    for (const el of silenced) el.inert = false
  }
}

/**
 * Holds the keyboard — and everything else — inside an open overlay.
 *
 * Two layers, because each covers what the other cannot:
 *
 * - The rest of the page is made `inert`. That is what actually contains
 *   things: a screen reader's cursor, a click, find-in-page and the Tab key all
 *   stop seeing it, which a key handler alone never achieves.
 * - Tab wraps from the last control to the first (and back with Shift). Inert
 *   alone lets focus walk out into the browser's own toolbar, which is how a
 *   native modal behaves but not what a keyboard user expects of a dialog.
 *
 * `getRoots` may return several elements: the mobile menu is a dialog whose
 * close button lives in the header above it, so both stay live and the loop
 * runs through the header and then the menu. It is called again on every Tab,
 * so it may return whatever is mounted at that moment.
 *
 * Opening and closing focus — where it lands, where it goes back to — is left
 * to the overlay, which knows its own choreography.
 */
export function useFocusTrap(active: boolean, getRoots: () => Roots): void {
  const roots = useRef(getRoots)
  useEffect(() => {
    roots.current = getRoots
  })

  useEffect(() => {
    if (!active) return
    const live = () => roots.current().filter((el): el is HTMLElement => !!el && el.isConnected)
    // With nothing to keep, "everything outside" is the whole page. An overlay
    // that has not mounted must not be able to switch the site off.
    const mounted = live()
    const release = mounted.length ? silenceOutside(mounted) : () => {}

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
      const current = live()
      if (!current.length) return
      const stops = current.flatMap(tabbable)
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (!first || !last) {
        // Nothing to land on: stay put rather than leave.
        event.preventDefault()
        return
      }
      const focused = document.activeElement
      // Focus that has fallen out — to <body>, say, because what held it was
      // removed — is brought back in from whichever end Tab was heading for.
      const inside = current.some((root) => root.contains(focused))
      if (event.shiftKey ? !inside || focused === first : !inside || focused === last) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      release()
    }
  }, [active])
}
