import { describe, expect, it } from 'vitest'
import { appleGraphics, classifyRenderer, iosVersion, tierFor, type DeviceFacts } from '@/hooks/useDeviceTier'
import { walkDpr } from '@/components/three/evoWalk'
import { valleyQuality } from '@/lib/valley'

/**
 * Apple devices, which Safari will not name: every one says "Apple GPU" and
 * none gives its memory, so every iPhone came out on the lowest tier. The user
 * agents here are what those browsers really send.
 */

const UA = {
  iphoneSafari17: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  // iOS 26: Safari froze the system's version at 18.6 and gives its own after Version/.
  iphoneSafari26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1',
  // An app's own browser (Telegram, Instagram): the system's version and no Version/.
  iphoneInApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  // An iPhone X, which iOS 17 left behind.
  iphoneX: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  // An iPad asks for the desktop site, and so does a Mac.
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
}

describe("Apple's own graphics", () => {
  it('are told by ASTC, on an iPhone, an iPad that says it is a Mac, and a Mac', () => {
    expect(appleGraphics('Apple GPU', true, UA.iphoneSafari17, 5)).toBe('mobile')
    expect(appleGraphics('Apple GPU', true, UA.iphoneInApp, 5)).toBe('mobile')
    expect(appleGraphics('Apple GPU', true, UA.macSafari, 5)).toBe('mobile')
    expect(appleGraphics('Apple GPU', true, UA.macSafari, 0)).toBe('mac')
    expect(appleGraphics('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', true, UA.macChrome, 0)).toBe('mac')
  })

  it('are a Mac, not an iPad, in Chrome on a Mac pretending to be a phone', () => {
    expect(appleGraphics('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', true, UA.macChrome, 5)).toBe('mac')
  })

  it('are not an older Mac that Safari also calls "Apple GPU", nor an Android phone that decodes ASTC', () => {
    expect(appleGraphics('Apple GPU', false, UA.macSafari, 0)).toBeNull()
    expect(appleGraphics('Adreno (TM) 740', true, UA.android, 5)).toBeNull()
    expect(appleGraphics('Mali-G715', true, UA.android, 5)).toBeNull()
  })

  it('make a Mac strong in any browser: an M-series in Safari is the one it is in Chrome', () => {
    expect(classifyRenderer('Apple GPU', 'mac')).toBe('strong')
    expect(classifyRenderer('Apple GPU', 'mobile')).toBe('modest')
    expect(classifyRenderer('Apple GPU')).toBe('modest')
  })
})

describe('the version of iOS', () => {
  it.each([
    [UA.iphoneSafari17, 17],
    [UA.iphoneSafari26, 26],
    [UA.iphoneChrome, 17],
    [UA.iphoneInApp, 17],
    [UA.iphoneX, 16],
    [UA.android, 0],
  ])('%s is %i', (ua, version) => {
    expect(iosVersion(ua)).toBe(version)
  })
})

describe('the tier', () => {
  const facts = (over: Partial<DeviceFacts>): DeviceFacts => ({ touch: false, webgl: true, apple: null, ios: 0, ...over })

  it('is the middle one for any iPhone or iPad new enough for iOS 17, whatever cores it owns up to', () => {
    for (const cores of [undefined, 2, 6, 8]) expect(tierFor(facts({ touch: true, apple: 'mobile', ios: 17, cores }))).toBe('medium')
    expect(tierFor(facts({ touch: true, apple: 'mobile', ios: 26 }))).toBe('medium')
  })

  it('is still the lowest for an older one, for one saving data, and without WebGL', () => {
    expect(tierFor(facts({ touch: true, apple: 'mobile', ios: 16 }))).toBe('low')
    expect(tierFor(facts({ touch: true, apple: 'mobile', ios: 17, saveData: true }))).toBe('low')
    expect(tierFor(facts({ touch: true, apple: 'mobile', ios: 17, webgl: false }))).toBe('low')
  })

  it('takes a Mac with Apple graphics to have the 8 GB every one of them has', () => {
    expect(tierFor(facts({ apple: 'mac', cores: 8 }))).toBe('high')
    expect(tierFor(facts({ apple: 'mac', cores: 8, memory: 16 }))).toBe('high')
    // An older Mac in Safari, as before.
    expect(tierFor(facts({ cores: 8 }))).toBe('medium')
  })

  it('is what it was everywhere else', () => {
    expect(tierFor(facts({ cores: 8, memory: 8 }))).toBe('high')
    expect(tierFor(facts({ cores: 4, memory: 8 }))).toBe('medium')
    expect(tierFor(facts({ cores: 2, memory: 8 }))).toBe('low')
    expect(tierFor(facts({ touch: true, cores: 8, memory: 8 }))).toBe('medium')
    expect(tierFor(facts({ touch: true, cores: 6, memory: 8 }))).toBe('low')
  })
})

describe('what an Apple device is given', () => {
  it('an iPhone: the middle level of the walk and the cinematic, drawn at up to 1.5× in the walk', () => {
    expect(valleyQuality('medium', classifyRenderer('Apple GPU', 'mobile'), true)).toBe('medium')
    expect(walkDpr('medium', true)).toEqual([1, 1.5])
    expect(walkDpr('medium', false)).toBe(1)
    expect(walkDpr('high', true)).toEqual([1, 1.4])
  })

  it('a Mac with Apple graphics in Safari: what Chrome gives it', () => {
    expect(valleyQuality(tierFor({ touch: false, webgl: true, apple: 'mac', ios: 0, cores: 8 }), classifyRenderer('Apple GPU', 'mac'), false)).toBe('ultra')
  })
})
