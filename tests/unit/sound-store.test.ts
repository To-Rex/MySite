// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cue, grindSound, offerSound, resetSoundForTests, toggleSound, unlockSound } from '@/features/sound/store'

/**
 * When the page may and may not make noise. The browser's rule is that sound
 * waits for a gesture; the visitor's is that "off" means off, next time too.
 */

const engine = vi.hoisted(() => ({ attach: vi.fn(), cue: vi.fn(), grind: vi.fn(), muted: vi.fn() }))
vi.mock('@/features/sound/engine', () => ({ createEngine: () => engine }))

const contexts: FakeContext[] = []
class FakeContext {
  state = 'running'
  destination = {}
  resume = vi.fn(() => Promise.resolve())
  suspend = vi.fn(() => Promise.resolve())
  createBuffer = vi.fn(() => ({}))
  createBufferSource = vi.fn(() => ({ buffer: null, connect: vi.fn(), start: vi.fn() }))
  constructor() {
    contexts.push(this)
  }
}

/** Lets the dynamic import of the engine, and what follows it, finish. */
const settled = () => vi.dynamicImportSettled()
const statusOf = () => latest
let latest = ''

const IMPACT = { kind: 'impact', pan: 0, power: 1, first: false } as const

async function watchStatus() {
  const { useSoundStatus } = await import('@/features/sound/store')
  const { renderHook } = await import('@testing-library/react')
  const view = renderHook(() => useSoundStatus())
  latest = view.result.current
  return () => {
    view.rerender()
    latest = view.result.current
  }
}

beforeEach(() => {
  resetSoundForTests()
  localStorage.clear()
  contexts.length = 0
  Object.values(engine).forEach((mock) => mock.mockClear())
  vi.stubGlobal('AudioContext', FakeContext)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sound', () => {
  it('is unavailable until the page offers it, and quiet about it', () => {
    cue(IMPACT)
    unlockSound()
    expect(engine.cue).not.toHaveBeenCalled()
    expect(contexts).toHaveLength(0)
  })

  it('stays unavailable where there is no Web Audio', async () => {
    vi.stubGlobal('AudioContext', undefined)
    offerSound()
    const refresh = await watchStatus()
    refresh()
    expect(statusOf()).toBe('unavailable')
  })

  it('waits for a gesture: offering it makes no audio context at all', async () => {
    offerSound()
    const refresh = await watchStatus()
    refresh()
    expect(statusOf()).toBe('locked')
    expect(contexts).toHaveLength(0)
  })

  it('opens on the first gesture, inside that gesture', async () => {
    offerSound()
    unlockSound()
    // Synchronously: a dynamic import would come back too late to count as the click.
    expect(contexts).toHaveLength(1)
    expect(contexts[0]!.resume).toHaveBeenCalled()
    await settled()
    expect(engine.attach).toHaveBeenCalledWith(contexts[0])
  })

  it('tries again on a later click if the browser refused the first', async () => {
    offerSound()
    unlockSound()
    await settled()
    contexts[0]!.state = 'suspended'
    contexts[0]!.resume.mockClear()
    unlockSound()
    expect(contexts[0]!.resume).toHaveBeenCalledTimes(1)
    expect(contexts).toHaveLength(1)
  })

  it('forwards cues only while it is on', async () => {
    offerSound()
    cue(IMPACT)
    grindSound(1, 0)
    unlockSound()
    await settled()
    expect(engine.cue).not.toHaveBeenCalled()
    cue(IMPACT)
    grindSound(0.5, -0.5)
    expect(engine.cue).toHaveBeenCalledWith(IMPACT)
    expect(engine.grind).toHaveBeenCalledWith(0.5, -0.5)
    toggleSound()
    cue(IMPACT)
    expect(engine.cue).toHaveBeenCalledTimes(1)
  })

  it('remembers being turned off, and a click on the page does not undo it', async () => {
    offerSound()
    unlockSound()
    await settled()
    toggleSound()
    expect(engine.muted).toHaveBeenLastCalledWith(true)
    expect(localStorage.getItem('dh.sound')).toBe('off')

    resetSoundForTests()
    contexts.length = 0
    offerSound()
    const refresh = await watchStatus()
    refresh()
    expect(statusOf()).toBe('off')
    unlockSound()
    expect(contexts).toHaveLength(0)
  })

  it('comes back on the button, and forgets the "off"', async () => {
    localStorage.setItem('dh.sound', 'off')
    offerSound()
    toggleSound()
    await settled()
    expect(contexts).toHaveLength(1)
    expect(engine.muted).toHaveBeenLastCalledWith(false)
    expect(localStorage.getItem('dh.sound')).toBeNull()
  })

  it('goes quiet with the tab, as the scene does', async () => {
    offerSound()
    unlockSound()
    await settled()
    const hidden = vi.spyOn(document, 'hidden', 'get')
    hidden.mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(contexts[0]!.suspend).toHaveBeenCalled()
    hidden.mockReturnValue(false)
    contexts[0]!.resume.mockClear()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(contexts[0]!.resume).toHaveBeenCalled()
    hidden.mockRestore()
  })
})
