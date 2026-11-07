// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFocusTrap } from '@/hooks/useFocusTrap'

/**
 * The trap's logic, in a DOM without layout. Whether a real browser's Tab key
 * honours it — and whether the dialog and the menu are wired to it — is
 * tests/e2e/overlays.spec.ts and tests/e2e/menu.spec.ts.
 */

function Page({ open, withHeader = false }: { open: boolean; withHeader?: boolean }) {
  const header = useRef<HTMLElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  useFocusTrap(open, () => (withHeader ? [header.current, overlay.current] : [overlay.current]))
  return (
    <>
      <header ref={header} data-testid="header">
        <button>menu</button>
        <button data-hidden>desktop only</button>
      </header>
      <main data-testid="main">
        <button>behind</button>
        <section data-testid="section">
          <p data-testid="sibling">text</p>
          {open && (
            <div ref={overlay} data-testid="overlay">
              <button tabIndex={-1}>backdrop</button>
              <button>first</button>
              <a href="#x">middle</a>
              <button disabled>disabled</button>
              <button>last</button>
            </div>
          )}
        </section>
      </main>
      <footer data-testid="footer">
        <a href="#y">footer link</a>
      </footer>
    </>
  )
}

const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey })
const byText = (text: string) => [...document.querySelectorAll<HTMLElement>('button, a')].find((el) => el.textContent === text)!

beforeEach(() => {
  // jsdom has no layout, so nothing has client rects. Give everything one,
  // except what a stylesheet would have hidden.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.hasAttribute('data-hidden') ? [] : [{}]) as unknown as DOMRectList
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useFocusTrap', () => {
  it('wraps Tab from the last control to the first, and Shift+Tab back', () => {
    render(<Page open />)
    byText('last').focus()
    // `fireEvent` returns false when the handler called preventDefault.
    expect(tab()).toBe(false)
    expect(document.activeElement).toBe(byText('first'))
    expect(tab(true)).toBe(false)
    expect(document.activeElement).toBe(byText('last'))
  })

  it('leaves Tab alone in the middle, where the browser already does the right thing', () => {
    render(<Page open />)
    byText('middle').focus()
    expect(tab()).toBe(true)
    expect(tab(true)).toBe(true)
    expect(document.activeElement).toBe(byText('middle'))
  })

  it('skips what cannot be tabbed to: disabled, tabindex=-1, not rendered', () => {
    render(<Page open withHeader />)
    // First stop is the header's visible button — not the hidden one after it.
    byText('last').focus()
    tab()
    expect(document.activeElement).toBe(byText('menu'))
    // And backwards from there lands on the overlay's last enabled control.
    tab(true)
    expect(document.activeElement).toBe(byText('last'))
  })

  it('pulls focus back in when it has fallen out of the overlay', () => {
    render(<Page open />)
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    tab()
    expect(document.activeElement).toBe(byText('first'))
  })

  it('makes the rest of the page inert, and only the rest', () => {
    const { getByTestId } = render(<Page open />)
    expect(getByTestId('header').inert).toBe(true)
    expect(getByTestId('footer').inert).toBe(true)
    expect(byText('behind').inert).toBe(true)
    expect(getByTestId('sibling').inert).toBe(true)
    // Ancestors of the overlay must stay live, or the overlay goes with them.
    expect(getByTestId('main').inert).toBeFalsy()
    expect(getByTestId('section').inert).toBeFalsy()
    expect(getByTestId('overlay').inert).toBeFalsy()
  })

  it('keeps a second root live — the header that holds the menu button', () => {
    const { getByTestId } = render(<Page open withHeader />)
    expect(getByTestId('header').inert).toBeFalsy()
    expect(getByTestId('footer').inert).toBe(true)
  })

  it('gives the page back when it closes, leaving alone what was already inert', () => {
    const { getByTestId, rerender } = render(<Page open={false} />)
    getByTestId('footer').inert = true
    rerender(<Page open />)
    expect(getByTestId('header').inert).toBe(true)
    rerender(<Page open={false} />)
    expect(getByTestId('header').inert).toBeFalsy()
    expect(byText('behind').inert).toBeFalsy()
    expect(getByTestId('footer').inert).toBe(true)
    // And Tab is nobody's business again.
    byText('behind').focus()
    expect(tab()).toBe(true)
  })

  it('never silences the page for an overlay that is not there', () => {
    function Broken() {
      useFocusTrap(true, () => [null])
      return <button>only</button>
    }
    render(<Broken />)
    expect(byText('only').inert).toBeFalsy()
    byText('only').focus()
    expect(tab()).toBe(true)
  })
})
