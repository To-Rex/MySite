import { beforeAll, describe, expect, it } from 'vitest'
import { Biquad, RATE, TAU, at, closeLoop, normalize, random, samples, softClip } from '@/features/sound/dsp'
import { BANKS, LOOPS, VOICES, VOICE_NAMES, type VoiceName } from '@/features/sound/voices'

/**
 * Sound, as numbers. Nothing here can tell you whether the roar is frightening;
 * that takes ears. What it can tell you is that nothing is silent, clipped or
 * broken, that the animal is built the way it was meant to be, and that a loop
 * really loops, which are the things that go wrong without anybody noticing.
 */

const rendered = new Map<VoiceName, Float32Array[]>()
const voice = (name: VoiceName) => rendered.get(name)!
const mono = (name: VoiceName) => voice(name)[0]!

// Every voice on the site, which is a few seconds of arithmetic on its own and
// more on a CI runner sharing its cores with the rest of the suite.
beforeAll(() => {
  for (const name of VOICE_NAMES) rendered.set(name, VOICES[name]())
}, 120_000)

function rms(channel: Float32Array, from: number, to: number): number {
  const a = samples(from)
  const b = Math.min(channel.length, samples(to))
  let sum = 0
  for (let i = a; i < b; i++) sum += channel[i]! * channel[i]!
  return Math.sqrt(sum / Math.max(1, b - a))
}

/** Power at a set of log-spaced frequencies over a stretch of the sound. */
function spectrum(channel: Float32Array, from: number, to: number): { frequency: number; power: number }[] {
  const a = samples(from)
  const b = Math.min(channel.length, a + 8192, samples(to))
  const out: { frequency: number; power: number }[] = []
  for (let k = 0; k < 44; k++) {
    const frequency = 40 * 1.14 ** k
    let re = 0
    let im = 0
    for (let i = a; i < b; i++) {
      const w = 0.5 - 0.5 * Math.cos((TAU * (i - a)) / (b - a))
      re += channel[i]! * w * Math.cos((TAU * frequency * i) / RATE)
      im += channel[i]! * w * Math.sin((TAU * frequency * i) / RATE)
    }
    out.push({ frequency, power: re * re + im * im })
  }
  return out
}

/** Where the energy sits, in Hz: higher means brighter. */
function brightness(channel: Float32Array, from: number, to: number): number {
  const bands = spectrum(channel, from, to)
  return bands.reduce((sum, band) => sum + band.frequency * band.power, 0) / bands.reduce((sum, band) => sum + band.power, 0)
}

/** The share of the energy between two frequencies. */
function share(channel: Float32Array, from: number, to: number, low: number, high: number): number {
  const bands = spectrum(channel, from, to)
  const total = bands.reduce((sum, band) => sum + band.power, 0)
  return bands.filter((band) => band.frequency >= low && band.frequency <= high).reduce((sum, band) => sum + band.power, 0) / total
}

describe('the arithmetic', () => {
  it('draws the same random numbers from the same seed', () => {
    const a = random(7)
    const b = random(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(random(8)()).not.toBe(random(7)())
  })

  it('reads breakpoints between their values and holds them past the ends', () => {
    const points = [
      [1, 10],
      [2, 20],
    ] as const
    expect(at(points, 0)).toBe(10)
    expect(at(points, 1.5)).toBe(15)
    expect(at(points, 9)).toBe(20)
  })

  it('saturates without ever exceeding full scale', () => {
    for (const x of [-5, -1, 0, 1, 5]) expect(Math.abs(softClip(x, 3))).toBeLessThanOrEqual(1.34)
    expect(softClip(1, 3)).toBeCloseTo(1, 5)
  })

  it('filters what it says it filters', () => {
    const tone = (frequency: number) => Float32Array.from({ length: 8192 }, (_, i) => Math.sin((TAU * frequency * i) / RATE))
    const through = (filter: Biquad, input: Float32Array) => {
      const out = input.map((x) => filter.run(x))
      return Math.sqrt(out.slice(2048).reduce((sum, x) => sum + x * x, 0) / 6144)
    }
    expect(through(new Biquad().lowpass(200, 0.7), tone(4000))).toBeLessThan(0.01)
    expect(through(new Biquad().lowpass(4000, 0.7), tone(200))).toBeGreaterThan(0.6)
    expect(through(new Biquad().highpass(4000, 0.7), tone(200))).toBeLessThan(0.01)
    expect(through(new Biquad().bandpass(1000, 4), tone(1000))).toBeGreaterThan(0.65)
    expect(through(new Biquad().bandpass(1000, 4), tone(100))).toBeLessThan(0.05)
  })

  it('removes DC and scales to the peak it was asked for', () => {
    const [channel] = normalize([Float32Array.from([1.5, 2.5, 1.5, 2.5])], 0.5)
    expect(Math.max(...channel!.map(Math.abs))).toBeCloseTo(0.5, 5)
    expect(channel!.reduce((sum, x) => sum + x, 0)).toBeCloseTo(0, 5)
  })

  it('shortens a loop by exactly the part it folded back', () => {
    expect(closeLoop(new Float32Array(samples(3)), 1)).toHaveLength(samples(2))
  })
})

describe.each(VOICE_NAMES)('the voice %s', (name) => {
  it('is real numbers, in range, and not silent', () => {
    for (const channel of voice(name)) {
      expect(channel.length).toBeGreaterThan(1000)
      // One expect at the end, not one a sample: the bed alone is 1.4 million of
      // them, which is long enough to time out on a CI runner.
      let peak = 0
      let broken = 0
      for (const value of channel) {
        if (!Number.isFinite(value)) broken++
        peak = Math.max(peak, Math.abs(value))
      }
      expect(broken).toBe(0)
      expect(peak).toBeLessThanOrEqual(1)
      expect(peak).toBeGreaterThan(0.2)
    }
  })

  it('has no DC offset to thump the speaker with', () => {
    for (const channel of voice(name)) expect(Math.abs(channel.reduce((sum, x) => sum + x, 0) / channel.length)).toBeLessThan(0.02)
  })

  it('has its channels the same length', () => {
    expect(new Set(voice(name).map((channel) => channel.length)).size).toBe(1)
    expect([1, 2]).toContain(voice(name).length)
  })

  it.skipIf((LOOPS as readonly VoiceName[]).includes(name) || name === 'reverb')('dies away before it ends', () => {
    for (const channel of voice(name)) expect(Math.abs(channel[channel.length - 1]!)).toBeLessThan(0.05)
  })
})

describe('the tyrannosaur', () => {
  it('breathes in before it opens its mouth, so sound and animation line up', () => {
    const roar = mono('roar')
    expect(rms(roar, 0, 0.4)).toBeLessThan(rms(roar, 0.7, 1.5) / 3)
    expect(rms(roar, 0.05, 0.42)).toBeGreaterThan(0.002)
  })

  it('is loudest while its head is up and then runs out of air', () => {
    const roar = mono('roar')
    expect(rms(roar, 0.7, 1.5)).toBeGreaterThan(rms(roar, 2.9, 3.5) * 3)
  })

  it('darkens as it fades, from a scream to a rattle', () => {
    const roar = mono('roar')
    expect(brightness(roar, 0.75, 0.95)).toBeGreaterThan(brightness(roar, 3.1, 3.3) * 1.25)
  })

  it('has its weight where small speakers can play it', () => {
    // Phones roll off below a few hundred hertz. A roar that lives down there is silence.
    expect(share(mono('roar'), 0.8, 1, 300, 5000)).toBeGreaterThan(0.25)
  })

  it('growls much lower than it roars', () => {
    expect(brightness(mono('growl'), 1, 1.2)).toBeLessThan(brightness(mono('roar'), 0.8, 1))
  })

  it('hits the ground all at once', () => {
    const stomp = mono('stompA')
    expect(rms(stomp, 0, 0.2)).toBeGreaterThan(rms(stomp, 0.5, 0.9) * 5)
    expect(share(stomp, 0, 0.18, 30, 240)).toBeGreaterThan(0.25)
  })

  it('varies its steps', () => {
    expect(Array.from(mono('stompA').slice(0, 2000))).not.toEqual(Array.from(mono('stompB').slice(0, 2000)))
  })

  it('comes out the same on every visit', () => {
    expect(Array.from(VOICES.snarl()[0]!)).toEqual(Array.from(mono('snarl')))
  })
})

describe('the sky', () => {
  it.each(['whooshLong', 'whooshShort'] as const)('%s climbs all the way to the moment it lands', (name) => {
    const channel = mono(name)
    const length = channel.length / RATE
    expect(rms(channel, length * 0.75, length * 0.98)).toBeGreaterThan(rms(channel, 0, length * 0.25) * 4)
  })

  it('lands in stereo', () => {
    const [left, right] = voice('impactBig') as [Float32Array, Float32Array]
    expect(Array.from(left.slice(20000, 21000))).not.toEqual(Array.from(right.slice(20000, 21000)))
  })

  it('goes on for longer the first time', () => {
    expect(mono('impactBig').length).toBeGreaterThan(mono('impactMid').length)
  })

  it('falls away after the bang', () => {
    const big = mono('impactBig')
    expect(rms(big, 0, 0.5)).toBeGreaterThan(rms(big, 5.5, 6.5) * 10)
  })
})

describe('the rest of the world', () => {
  it('rains stones for the whole of the assembly', () => {
    const rain = mono('stoneRain')
    for (const second of [0, 1, 2]) expect(rms(rain, second, second + 1)).toBeGreaterThan(0.005)
  })

  it('has the flyers calling far above the tyrannosaur', () => {
    expect(brightness(mono('screechLong'), 0.1, 0.4)).toBeGreaterThan(brightness(mono('roar'), 0.8, 1) * 1.5)
  })

  it.each(LOOPS)('%s loops without a click', (name) => {
    for (const channel of voice(name)) {
      let steps = 0
      for (let i = 1; i < channel.length; i++) steps += Math.abs(channel[i]! - channel[i - 1]!)
      const typical = steps / (channel.length - 1)
      // The seam should be no bigger a step than any other pair of samples.
      expect(Math.abs(channel[0]! - channel[channel.length - 1]!)).toBeLessThan(typical * 8 + 0.002)
    }
  })

  it('has an ambience that a laptop can actually play', () => {
    expect(share(mono('bed'), 4, 4.2, 250, 8000)).toBeGreaterThan(0.01)
  })

  it('decays the reverb to nothing', () => {
    const reverb = mono('reverb')
    expect(rms(reverb, 0, 0.3)).toBeGreaterThan(rms(reverb, 3, 3.4) * 80)
  })
})

describe('the banks', () => {
  it.each(Object.entries(BANKS))('%s asks only for voices that exist, each once', (_, names) => {
    for (const name of names) expect(VOICE_NAMES).toContain(name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('renders every voice for one page or another', () => {
    const used = new Set(Object.values(BANKS).flat())
    expect(VOICE_NAMES.filter((name) => !used.has(name))).toEqual([])
  })

  it('has the reverb first on both pages, since everything plays through it', () => {
    expect(BANKS.notFound).toContain('reverb')
    expect(BANKS.valley[0]).toBe('reverb')
  })

  it('keeps each page to its own loops', () => {
    expect(BANKS.valley).not.toContain('bed')
    expect(BANKS.valley).not.toContain('grind')
    expect(BANKS.notFound).not.toContain('valleyAir')
  })
})

describe('the valley', () => {
  it('has a herd that sounds the size it is: the sauropod well below the stegosaur', () => {
    // Size is heard in the formants: more of a small animal's voice is up high.
    expect(share(mono('stegoGrunt'), 0.1, 0.3, 500, 4000)).toBeGreaterThan(share(mono('sauropodCall'), 1, 1.2, 500, 4000) * 1.5)
  })

  it('still puts the sauropod where a phone can play it', () => {
    expect(share(mono('sauropodCall'), 1, 1.2, 120, 2000)).toBeGreaterThan(0.25)
  })

  it('brings the rock in growing until the moment it lands', () => {
    const entry = mono('entry')
    const length = entry.length / RATE
    expect(rms(entry, length * 0.8, length * 0.98)).toBeGreaterThan(rms(entry, 0, length * 0.2) * 6)
  })

  it('cracks twice as the shock wave goes over', () => {
    const boom = mono('sonicBoom')
    const peaks = [rms(boom, 0, 0.04), rms(boom, 0.13, 0.17)]
    for (const p of peaks) expect(p).toBeGreaterThan(rms(boom, 1.2, 1.6) * 3)
  })

  it('leaves a high ring after the flash, the ears not the world', () => {
    const ring = mono('flashRing')
    const high = new Biquad().highpass(3000, 0.7)
    const filtered = ring.map((x) => high.run(x))
    // Once the thump has gone, what is left is nearly all ring.
    expect(rms(filtered, 1.2, 1.4)).toBeGreaterThan(rms(ring, 1.2, 1.4) * 0.8)
    expect(rms(ring, 1.2, 1.4)).toBeGreaterThan(0.01)
  })

  it('cracks with near thunder and only rolls with far', () => {
    expect(rms(mono('thunderNear'), 0, 0.08)).toBeGreaterThan(rms(mono('thunderFar'), 0, 0.08) * 3)
    expect(brightness(mono('thunderFar'), 1, 1.2)).toBeLessThan(brightness(mono('thunderNear'), 1, 1.2))
  })

  it('brings the morning in slowly, as a chord', () => {
    const dawn = mono('dawn')
    expect(rms(dawn, 0, 0.3)).toBeLessThan(rms(dawn, 2.5, 3) / 4)
    expect(share(dawn, 2.5, 2.7, 100, 520)).toBeGreaterThan(0.6)
  })
})

