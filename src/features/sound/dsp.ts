/**
 * Arithmetic for sound: oscillators, filters and envelopes as plain functions
 * over numbers. Free of the browser, so it runs in a worker and in a unit test,
 * and free of packages, so the worker does not ship a second copy of anything.
 */

export const RATE = 44100
export const TAU = Math.PI * 2

export const samples = (seconds: number): number => Math.round(seconds * RATE)

export type Random = () => number

/** Mulberry32: the same voice comes out of the same seed on every machine. */
export function random(seed: number): Random {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Breakpoints over time, [seconds, value]. Holds the end values outside its range. */
export type Points = readonly (readonly [number, number])[]

export function at(points: Points, t: number): number {
  const last = points.length - 1
  if (t <= points[0]![0]) return points[0]![1]
  if (t >= points[last]![0]) return points[last]![1]
  for (let i = 1; i <= last; i++) {
    const [t1, v1] = points[i]!
    if (t < t1) {
      const [t0, v0] = points[i - 1]!
      return v0 + (v1 - v0) * ((t - t0) / (t1 - t0))
    }
  }
  return points[last]![1]
}

export const mix = (a: number, b: number, u: number): number => a + (b - a) * u

/** Saturation, normalised so a full-scale input stays at full scale. */
export const softClip = (x: number, drive: number): number => Math.tanh(x * drive) / Math.tanh(drive)

/** Two-pole filters from the RBJ cookbook. */
export class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): void {
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
  }

  lowpass(frequency: number, q: number): this {
    const w = (TAU * Math.min(frequency, RATE * 0.45)) / RATE
    const c = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha)
    return this
  }

  highpass(frequency: number, q: number): this {
    const w = (TAU * Math.min(frequency, RATE * 0.45)) / RATE
    const c = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha)
    return this
  }

  /** Peaks at 0 dB whatever the width. */
  bandpass(frequency: number, q: number): this {
    const w = (TAU * Math.min(frequency, RATE * 0.45)) / RATE
    const alpha = Math.sin(w) / (2 * q)
    this.set(alpha, 0, -alpha, 1 + alpha, -2 * Math.cos(w), 1 - alpha)
    return this
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

/** A value that wanders between -1 and 1 at about `rate` changes a second. */
export function wander(r: Random, rate: number): () => number {
  let a = r() * 2 - 1
  let b = r() * 2 - 1
  let phase = 0
  const step = rate / RATE
  return () => {
    phase += step
    if (phase >= 1) {
      phase -= 1
      a = b
      b = r() * 2 - 1
    }
    return a + (b - a) * (phase * phase * (3 - 2 * phase))
  }
}

/** Brown noise: most of its energy at the bottom, like distance and weight. */
export function brown(r: Random): () => number {
  let v = 0
  return () => {
    v = (v + 0.02 * (r() * 2 - 1)) / 1.02
    return v * 3.5
  }
}

/** Pink noise, Paul Kellet's economy filter. Air, wind, anything broad. */
export function pink(r: Random): () => number {
  let b0 = 0
  let b1 = 0
  let b2 = 0
  return () => {
    const white = r() * 2 - 1
    b0 = 0.99765 * b0 + white * 0.099046
    b1 = 0.963 * b1 + white * 0.2965164
    b2 = 0.57 * b2 + white * 1.0526913
    return (b0 + b1 + b2 + white * 0.1848) * 0.2
  }
}

/** Takes out any DC and scales the loudest sample to `peak`. */
export function normalize(channels: Float32Array[], peak: number): Float32Array[] {
  let loudest = 0
  for (const channel of channels) {
    let sum = 0
    for (const value of channel) sum += value
    const dc = sum / Math.max(1, channel.length)
    for (let i = 0; i < channel.length; i++) {
      channel[i]! -= dc
      loudest = Math.max(loudest, Math.abs(channel[i]!))
    }
  }
  if (loudest > 0) {
    const scale = peak / loudest
    for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i]! *= scale
  }
  return channels
}

/** Short ramps at both ends, so nothing starts or stops with a click. */
export function fadeEdges(channel: Float32Array, inSeconds: number, outSeconds: number): Float32Array {
  const a = Math.min(channel.length, samples(inSeconds))
  const b = Math.min(channel.length, samples(outSeconds))
  for (let i = 0; i < a; i++) channel[i]! *= i / a
  for (let i = 0; i < b; i++) channel[channel.length - 1 - i]! *= i / b
  return channel
}

/** Adds `layer` into `target`, starting `offset` seconds in. */
export function addInto(target: Float32Array, layer: Float32Array, offset: number, gain: number): void {
  const start = samples(offset)
  const end = Math.min(target.length, start + layer.length)
  for (let i = start; i < end; i++) target[i]! += layer[i - start]! * gain
}

/**
 * Makes a buffer loop without a seam: the extra `fade` seconds rendered past the
 * end are cross-faded over the beginning, at equal power, and cut off.
 */
export function closeLoop(channel: Float32Array, fade: number): Float32Array {
  const overlap = samples(fade)
  const length = channel.length - overlap
  const out = channel.slice(0, length)
  for (let i = 0; i < overlap; i++) {
    const u = (i / overlap) * (Math.PI / 2)
    out[i] = channel[i]! * Math.sin(u) + channel[length + i]! * Math.cos(u)
  }
  return out
}
