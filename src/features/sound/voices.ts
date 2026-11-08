import { Biquad, RATE, TAU, addInto, at, brown, closeLoop, fadeEdges, mix, normalize, pink, random, samples, softClip, wander, type Points, type Random } from './dsp'

/**
 * Every sound on the 404 page, written as arithmetic. There are no audio files
 * in this site for the same reason there are no models or textures: all of it
 * comes out of code, so there is nothing to license, download or go missing.
 *
 * The animals are made the way a throat makes sound. A train of pulses from the
 * vocal folds, uneven and breaking up as the voice strains, goes through a bank
 * of resonators that stands in for the vocal tract. What makes the tyrannosaur
 * sound huge is not that its voice is low; it is that its formants are low and
 * close together, the mark of a very long throat, which is the cue a listener
 * uses to judge the size of whatever is making a noise.
 */

/* -------------------------------------------------------------------------- */
/* A throat                                                                    */
/* -------------------------------------------------------------------------- */

export interface VocalSpec {
  seconds: number
  seed: number
  /** Fundamental, Hz. */
  pitch: Points
  /** Overall level, 0..1. */
  level: Points
  /** 0 = mouth closed, 1 = wide open: slides the formants between the two sets. */
  open: Points
  /** How much of the excitation is turbulent air rather than voice. */
  breath: Points
  /** Jitter, shimmer and period doubling: a clean voice at 0, a torn one at 1. */
  rough: Points
  /** Depth of the rattle in the throat. */
  flutter: Points
  flutterRate: number
  /** How far the rattle bends the pitch, as a fraction, at full flutter. */
  bend: number
  formantsClosed: readonly number[]
  formantsOpen: readonly number[]
  widths: readonly number[]
  gains: readonly number[]
  /** A sub-octave sine under it, felt more than heard. */
  chest: number
  drive: number
  /** A second, inharmonic voice from the other fold: what makes a roar snarl. */
  second?: { ratio: number; level: Points }
}

/** One cycle of glottal flow: a slow opening and a sudden closing, then nothing. */
function glottal(phase: number, opening: number, closing: number): number {
  if (phase < opening) return 0.5 * (1 - Math.cos((Math.PI * phase) / opening))
  if (phase < opening + closing) return Math.cos(((Math.PI / 2) * (phase - opening)) / closing)
  return 0
}

export function renderVocal(spec: VocalSpec): Float32Array {
  const n = samples(spec.seconds)
  const body = new Float32Array(n)
  const r = random(spec.seed)
  const filters = spec.formantsOpen.map(() => new Biquad())
  // A throat is soft and moves. Formants that hold perfectly still read as a vowel,
  // and then as a machine saying that vowel.
  const shifting = spec.formantsOpen.map(() => wander(r, 4))
  const vibrato = wander(r, 7)
  const drift = wander(r, 1.6)

  let f0 = at(spec.pitch, 0)
  let phaseA = r()
  let phaseB = r()
  let jitterA = 1
  let jitterB = 1
  let shimmerA = 1
  let shimmerB = 1
  let cycle = 0
  let previousA = 0
  let previousB = 0
  let pitchTarget = f0
  let level = 0
  let open = 0
  let breath = 0
  let rough = 0
  let secondLevel = 0
  let flutter = 0
  let bendPhase = r()
  const uneven = wander(r, spec.flutterRate * 0.6)

  // ---- Pulses through the vocal tract -----------------------------------------
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    if (i % 32 === 0) {
      pitchTarget = at(spec.pitch, t)
      level = at(spec.level, t)
      open = at(spec.open, t)
      breath = at(spec.breath, t)
      rough = at(spec.rough, t)
      secondLevel = spec.second ? at(spec.second.level, t) : 0
      flutter = at(spec.flutter, t)
      for (let j = 0; j < filters.length; j++) {
        for (let skip = 0; skip < 31; skip++) shifting[j]!()
        filters[j]!.bandpass(mix(spec.formantsClosed[j]!, spec.formantsOpen[j]!, open) * (1 + shifting[j]!() * (0.03 + rough * 0.07)), spec.widths[j]!)
      }
    }
    // A fast slew: pitch glides between breakpoints instead of stepping.
    f0 += (pitchTarget - f0) * 0.0025
    bendPhase += spec.flutterRate / RATE
    if (bendPhase >= 1) bendPhase -= 1
    // Fast pitch modulation is what spreads clean harmonics into a growl.
    const bend = (Math.sin(TAU * bendPhase) * 0.7 + uneven() * 0.6) * flutter * spec.bend
    const f = f0 * (1 + vibrato() * (0.01 + rough * 0.035) + drift() * 0.02 + bend) * jitterA

    phaseA += f / RATE
    if (phaseA >= 1) {
      phaseA -= 1
      cycle++
      jitterA = 1 + (r() - 0.5) * (0.02 + rough * 0.15)
      // Every other pulse falters as the voice breaks up: period doubling.
      shimmerA = (1 + (r() - 0.5) * (0.1 + rough * 0.7)) * (cycle % 2 ? 1 - rough * 0.55 : 1)
    }
    const flowA = glottal(phaseA, 0.55, 0.08) * shimmerA
    // The radiated sound is the change in flow, and that grows with pitch.
    const pulseA = (flowA - previousA) * (RATE / (Math.max(f, 20) * 6))
    previousA = flowA

    let pulseB = 0
    if (spec.second && secondLevel > 0) {
      phaseB += (f * spec.second.ratio * jitterB) / RATE
      if (phaseB >= 1) {
        phaseB -= 1
        jitterB = 1 + (r() - 0.5) * (0.03 + rough * 0.2)
        shimmerB = 1 + (r() - 0.5) * (0.2 + rough * 0.6)
      }
      const flowB = glottal(phaseB, 0.5, 0.16) * shimmerB
      pulseB = (flowB - previousB) * (RATE / (Math.max(f, 20) * 6)) * secondLevel
      previousB = flowB
    }

    // Air only gets through while the folds are open, so the noise is pulsed too.
    const air = (r() * 2 - 1) * (0.25 + flowA * 0.75) * breath * 0.9
    const excitation = (pulseA + pulseB) * (1 - breath * 0.75) + air

    let tract = 0
    for (let j = 0; j < filters.length; j++) tract += filters[j]!.run(excitation) * spec.gains[j]!
    body[i] = tract * level
  }

  normalize([body], 1)

  // ---- Rattle, saturation and the chest ---------------------------------------
  const out = new Float32Array(n)
  const dc = new Biquad().highpass(26, 0.7)
  const top = new Biquad().lowpass(11500, 0.7)
  const wobble = wander(r, 5)
  let flutterPhase = r()
  let chestPhase = 0
  f0 = at(spec.pitch, 0)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    if (i % 32 === 0) {
      pitchTarget = at(spec.pitch, t)
      level = at(spec.level, t)
      rough = at(spec.flutter, t)
    }
    f0 += (pitchTarget - f0) * 0.0025
    flutterPhase += (spec.flutterRate * (1 + wobble() * 0.25)) / RATE
    if (flutterPhase >= 1) flutterPhase -= 1
    // Not a sine: the tract slaps shut, which is what makes it a rattle.
    const gate = 1 - rough * (1 - Math.abs(Math.sin(Math.PI * flutterPhase)) ** 0.6)
    chestPhase += (f0 * 0.5) / RATE
    if (chestPhase >= 1) chestPhase -= 1
    const chest = Math.sin(TAU * chestPhase) * spec.chest * level
    out[i] = dc.run(top.run(softClip(body[i]! * gate, spec.drive) + chest))
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* The tyrannosaur                                                             */
/* -------------------------------------------------------------------------- */

const REX_CLOSED = [88, 235, 470, 860, 1500, 2350] as const
const REX_OPEN = [150, 360, 730, 1280, 2100, 3100] as const
const REX_WIDTHS = [2.2, 2.8, 3.4, 3.8, 4.2, 4.6] as const
const REX_GAINS = [0.5, 0.82, 1, 1, 0.86, 0.6] as const

const rex = { formantsClosed: REX_CLOSED, formantsOpen: REX_OPEN, widths: REX_WIDTHS, gains: REX_GAINS }

/** Stretches a set of breakpoints in time and moves them along. */
const shifted = (points: Points, scale: number, by = 0): Points => points.map(([t, v]) => [t * scale + by, v] as const)

/**
 * The high edge at the front of a roar, the part that carries over distance:
 * a separate, narrow, trumpeting voice laid over the first second.
 */
function trumpet(seed: number, scale: number): Float32Array {
  return renderVocal({
    seconds: 1.15 * scale,
    seed,
    pitch: shifted([[0, 560], [0.09, 840], [0.4, 760], [0.8, 560], [1.15, 400]], scale),
    level: shifted([[0, 0], [0.07, 1], [0.55, 0.78], [0.95, 0.2], [1.15, 0]], scale),
    open: [[0, 1]],
    breath: [[0, 0.18]],
    rough: [[0, 0.22], [0.7, 0.42]],
    flutter: [[0, 0.1]],
    flutterRate: 70,
    bend: 0.06,
    formantsClosed: [900, 1500, 2300, 3200],
    formantsOpen: [1100, 1800, 2700, 3600],
    widths: [4, 6, 7, 8],
    gains: [0.8, 1, 0.75, 0.4],
    chest: 0,
    drive: 1.6,
  })
}

/** Air going in, fast, through a very large nose. */
function inhale(seed: number, seconds: number): Float32Array {
  const r = random(seed)
  const n = samples(seconds)
  const out = new Float32Array(n)
  const band = new Biquad()
  for (let i = 0; i < n; i++) {
    const u = i / n
    if (i % 32 === 0) band.bandpass(620 + u * 1500, 1.3)
    out[i] = band.run(r() * 2 - 1) * u * u * (1 - u ** 12) * 2.2
  }
  return out
}

/**
 * The roar. The first 0.42 s are the intake of breath that goes with the head
 * winding back, and the voice comes in as the head comes up, so the sound and
 * the animation line up when this is started at the start of the wind-up.
 */
function renderRoar(seed: number, scale: number, height: number): Float32Array {
  const voice = renderVocal({
    ...rex,
    seconds: 3.7 * scale,
    seed,
    pitch: shifted([[0, 96], [0.42, 110], [0.52, 190], [0.64, 300 * height], [0.86, 285 * height], [1.3, 245 * height], [1.85, 180 * height], [2.4, 112], [3, 70], [3.7, 46]], scale),
    level: shifted([[0, 0], [0.12, 0.04], [0.42, 0.1], [0.5, 0.42], [0.62, 1], [1.5, 0.92], [2.1, 0.68], [2.8, 0.34], [3.4, 0.1], [3.7, 0]], scale),
    open: shifted([[0, 0.12], [0.45, 0.2], [0.62, 1], [1.7, 0.92], [2.5, 0.48], [3.7, 0.08]], scale),
    breath: shifted([[0, 1], [0.42, 0.95], [0.56, 0.36], [1.7, 0.42], [2.7, 0.62], [3.7, 0.85]], scale),
    rough: shifted([[0, 0.25], [0.55, 0.55], [0.8, 0.8], [1.7, 0.88], [2.5, 1], [3.7, 1]], scale),
    flutter: shifted([[0, 0], [0.6, 0.24], [1.3, 0.42], [2.2, 0.64], [3.7, 0.86]], scale),
    flutterRate: 44,
    bend: 0.13,
    chest: 0.32,
    drive: 3.4,
    second: { ratio: 1.44, level: shifted([[0.5, 0], [0.66, 0.62], [1.5, 0.5], [2.2, 0.12], [2.6, 0]], scale) },
  })
  addInto(voice, fadeEdges(trumpet(seed + 7, scale), 0.01, 0.1), 0.56 * scale, 0.42)
  addInto(voice, inhale(seed + 3, 0.5 * scale), 0, 0.2)
  return voice
}

/** Mouth shut, deep in the chest: what it does while it is watching you. */
function renderGrowl(seed: number): Float32Array {
  return renderVocal({
    ...rex,
    seconds: 2.6,
    seed,
    pitch: [[0, 40], [0.7, 58], [1.6, 50], [2.6, 34]],
    level: [[0, 0], [0.5, 0.85], [1.6, 1], [2.6, 0]],
    open: [[0, 0.04], [1.2, 0.2], [2.6, 0]],
    breath: [[0, 0.3], [1.4, 0.16], [2.6, 0.4]],
    rough: [[0, 0.7], [1.4, 0.95]],
    flutter: [[0, 0.5], [1.4, 0.82]],
    flutterRate: 21,
    bend: 0.1,
    chest: 0.5,
    drive: 3.4,
  })
}

/** Short and open-mouthed: a reaction, not a statement. */
function renderSnarl(seed: number): Float32Array {
  return renderVocal({
    ...rex,
    seconds: 1.25,
    seed,
    pitch: [[0, 130], [0.11, 250], [0.5, 215], [0.9, 120], [1.25, 78]],
    level: [[0, 0], [0.08, 1], [0.6, 0.72], [1.25, 0]],
    open: [[0, 0.3], [0.12, 0.9], [0.8, 0.55], [1.25, 0.2]],
    breath: [[0, 0.5], [0.3, 0.42], [1.25, 0.75]],
    rough: [[0, 0.55], [0.5, 0.85]],
    flutter: [[0, 0.3], [0.7, 0.66]],
    flutterRate: 58,
    bend: 0.16,
    chest: 0.22,
    drive: 3.4,
    second: { ratio: 1.38, level: [[0, 0.3], [0.5, 0.45], [1, 0]] },
  })
}

/** A blast of air through the nostrils. */
function renderSnort(seed: number): Float32Array {
  const r = random(seed)
  const n = samples(0.6)
  const out = new Float32Array(n)
  const low = new Biquad()
  const high = new Biquad()
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    if (i % 32 === 0) {
      low.bandpass(320 - t * 240, 1.4)
      high.bandpass(1500 - t * 900, 1.1)
    }
    const envelope = at([[0, 0], [0.025, 1], [0.13, 0.55], [0.17, 0.72], [0.6, 0]], t)
    const noise = r() * 2 - 1
    out[i] = softClip((low.run(noise) * 1.3 + high.run(noise) * 0.8) * envelope * 3, 1.6)
  }
  return out
}

/** One footfall: the ground taking the weight, then the dirt settling. */
function renderStomp(seed: number): Float32Array {
  const r = random(seed)
  const n = samples(1)
  const out = new Float32Array(n)
  const click = new Biquad().lowpass(2400, 0.8)
  const dirt = new Biquad().bandpass(520 + r() * 300, 0.9)
  const grains = wander(r, 90)
  let phase = 0
  const pitch = 30 + r() * 6
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    phase += (pitch + 96 * Math.exp(-t / 0.05)) / RATE
    const body = Math.sin(TAU * phase) * Math.exp(-t / 0.2) * (1 - Math.exp(-t / 0.0018))
    const knock = (Math.sin(TAU * phase * 3.1) * 0.7 + Math.sin(TAU * phase * 5.3) * 0.4) * Math.exp(-t / 0.07)
    const noise = r() * 2 - 1
    const hit = click.run(noise) * Math.exp(-t / 0.018) * 1.7
    const settle = dirt.run(noise) * Math.exp(-t / 0.2) * (0.55 + grains() * 0.45) * 1.05
    out[i] = softClip(body + knock + hit + settle, 2.4)
  }
  return out
}

/** Teeth meeting: two hard clacks and the thud of the jaw behind them. */
function renderChomp(seed: number): Float32Array {
  const r = random(seed)
  const n = samples(0.3)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  ping(left, right, 0, 780 + r() * 240, 0.02, 1, 0, r)
  ping(left, right, 0.014, 1320 + r() * 500, 0.012, 0.8, 0, r)
  ping(left, right, 0.004, 210, 0.05, 0.7, 0, r)
  return left
}

/** Stone between teeth. */
function renderCrunch(seed: number): Float32Array {
  const r = random(seed)
  const n = samples(0.55)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  stoneShower(left, right, r, 36, 0, 0.34, 1.3)
  const grit = new Biquad().bandpass(1500, 0.8)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    left[i]! += grit.run(r() * 2 - 1) * Math.exp(-t / 0.12) * (r() > 0.6 ? 1.6 : 0.2) * 0.9
  }
  return left
}

/** Something large going down: a falling, closing bubble and a thump at the bottom. */
function renderGulp(seed: number): Float32Array {
  const r = random(seed)
  const n = samples(0.7)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    phase += (340 * Math.exp(-t / 0.14) + 70) / RATE
    out[i] = Math.sin(TAU * phase) * Math.sin(Math.min(1, t / 0.32) * Math.PI) ** 0.7 * 0.8
  }
  bubble(out, 0.36, 72, 1.6, 0.09, 1)
  bubble(out, 0.05 + r() * 0.03, 260, 4, 0.03, 0.3)
  return out
}

/** A very large animal, very bored. */
function renderYawn(seed: number): Float32Array {
  return renderVocal({
    ...rex,
    seconds: 2.9,
    seed,
    pitch: [[0, 58], [0.7, 96], [1.5, 84], [2.3, 58], [2.9, 40]],
    level: [[0, 0], [0.5, 0.45], [1.3, 1], [2.3, 0.6], [2.9, 0]],
    open: [[0, 0.1], [1.2, 1], [2.2, 0.8], [2.9, 0.2]],
    breath: [[0, 0.9], [0.8, 0.6], [1.6, 0.55], [2.9, 0.95]],
    rough: [[0, 0.5], [1.4, 0.72]],
    flutter: [[0, 0.1], [1.6, 0.34]],
    flutterRate: 26,
    bend: 0.06,
    chest: 0.3,
    drive: 2.2,
  })
}

/** Air going in through the nose, quickly, to see what is there. */
function renderSniff(seed: number): Float32Array {
  const r = random(seed)
  const n = samples(0.32)
  const out = new Float32Array(n)
  const band = new Biquad()
  for (let i = 0; i < n; i++) {
    const u = i / n
    if (i % 32 === 0) band.bandpass(1100 + u * 1500, 1.8)
    out[i] = band.run(r() * 2 - 1) * Math.sin(Math.PI * u) ** 1.6
  }
  return out
}

/** A tail, going past quickly. */
function renderSwish(seed: number): Float32Array {
  const r = random(seed)
  const n = samples(0.42)
  const out = new Float32Array(n)
  const band = new Biquad()
  for (let i = 0; i < n; i++) {
    const u = i / n
    if (i % 32 === 0) band.bandpass(280 + Math.sin(Math.PI * u) * 1500, 1)
    out[i] = band.run(r() * 2 - 1) * Math.sin(Math.PI * u) ** 2
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Meteors                                                                     */
/* -------------------------------------------------------------------------- */

/** Air tearing: climbs all the way to the moment it lands, then stops dead. */
function renderWhoosh(seed: number, seconds: number): Float32Array {
  const r = random(seed)
  const n = samples(seconds)
  const out = new Float32Array(n)
  const band = new Biquad()
  const under = new Biquad().lowpass(300, 0.7)
  const fire = new Biquad().highpass(1800, 0.7)
  const low = brown(r)
  for (let i = 0; i < n; i++) {
    const u = i / n
    if (i % 32 === 0) band.bandpass(220 + 2600 * u * u * u, 0.85)
    const noise = r() * 2 - 1
    const tear = band.run(noise) * (0.04 + u * u * 1.1)
    const weight = under.run(low()) * u * u * 1.6
    const spark = r() > 0.994 ? fire.run(noise) * 2.4 * u : fire.run(0)
    out[i] = softClip(tear + weight + spark, 1.4)
  }
  return fadeEdges(out, 0.08, 0.006)
}

/** A distant one, up in the sky: just a thin hiss going over. */
function renderFarStreak(seed: number): Float32Array {
  const r = random(seed)
  const n = samples(1.5)
  const out = new Float32Array(n)
  const band = new Biquad()
  for (let i = 0; i < n; i++) {
    const u = i / n
    if (i % 32 === 0) band.bandpass(5200 - u * 3600, 2.2)
    out[i] = band.run(r() * 2 - 1) * Math.sin(Math.PI * u) ** 2
  }
  return out
}

/** A stone hitting a stone, written into a stereo pair. */
function ping(left: Float32Array, right: Float32Array, start: number, frequency: number, decay: number, amplitude: number, pan: number, r: Random): void {
  const from = samples(start)
  const to = Math.min(left.length, from + samples(decay * 7))
  const gainL = Math.cos(((pan + 1) * Math.PI) / 4) * amplitude
  const gainR = Math.sin(((pan + 1) * Math.PI) / 4) * amplitude
  const ratioB = 2.74 + r() * 0.2
  const ratioC = 5.3 + r() * 0.5
  for (let i = from; i < to; i++) {
    const t = (i - from) / RATE
    const tone =
      (Math.sin(TAU * frequency * t) + Math.sin(TAU * frequency * ratioB * t) * 0.5 * Math.exp(-t / (decay * 0.4))) * Math.exp(-t / decay) +
      Math.sin(TAU * frequency * ratioC * t) * 0.22 * Math.exp(-t / (decay * 0.2))
    const crack = t < 0.003 ? (r() * 2 - 1) * (1 - t / 0.003) * 0.9 : 0
    const value = tone + crack
    left[i]! += value * gainL
    right[i]! += value * gainR
  }
}

/** Throws a shower of stones over `seconds`, weighted towards the front. */
function stoneShower(left: Float32Array, right: Float32Array, r: Random, count: number, from: number, spread: number, skew: number): void {
  for (let i = 0; i < count; i++) {
    const start = from + r() ** skew * spread
    const heavy = r() < 0.1
    const frequency = heavy ? 140 + r() * 220 : 620 + r() ** 1.6 * 3400
    ping(left, right, start, frequency, heavy ? 0.03 + r() * 0.03 : 0.006 + r() * 0.018, (heavy ? 0.34 : 0.3) * (0.2 + r() ** 2), (r() * 2 - 1) * 0.92, r)
  }
}

/**
 * It lands: a crack, a boom that falls away under the hearing, a wall of noise
 * closing down from bright to dark, and the debris coming back to earth.
 */
function renderImpact(seed: number, seconds: number, power: number): Float32Array[] {
  const r = random(seed)
  const n = samples(seconds)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  stoneShower(left, right, r, Math.round(120 * power), 0.22, 2.4 * power, 1.9)

  const filterL = new Biquad()
  const filterR = new Biquad()
  const rumbleL = new Biquad().lowpass(90, 0.7)
  const rumbleR = new Biquad().lowpass(90, 0.7)
  const lowL = brown(r)
  const lowR = brown(r)
  const swell = wander(r, 3)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    if (i % 32 === 0) {
      const cutoff = 380 + 7600 * Math.exp(-t / 0.24)
      filterL.lowpass(cutoff, 0.9)
      filterR.lowpass(cutoff * 1.07, 0.9)
    }
    phase += (26 + 62 * Math.exp(-t / 0.3)) / RATE
    const boom = (Math.sin(TAU * phase) + Math.sin(TAU * phase * 2.02) * 0.55 * Math.exp(-t / 0.7) + Math.sin(TAU * phase * 4.1) * 0.3 * Math.exp(-t / 0.4)) * Math.exp(-t / (0.95 * power)) * (1 - Math.exp(-t / 0.003))
    const crack = t < 0.09 ? Math.exp(-t / 0.009) * 1.2 : 0
    const blast = Math.exp(-t / (0.6 * power))
    const whiteL = r() * 2 - 1
    const whiteR = r() * 2 - 1
    const tail = Math.exp(-t / (1.7 * power)) * (0.7 + swell() * 0.3) * 1.3
    left[i]! += softClip(boom * 1.2 + filterL.run(whiteL) * blast * 1.9 + whiteL * crack + rumbleL.run(lowL()) * tail, 2.2)
    right[i]! += softClip(boom * 1.2 + filterR.run(whiteR) * blast * 1.9 + whiteR * crack + rumbleR.run(lowR()) * tail, 2.2)
  }
  fadeEdges(left, 0, 0.3)
  fadeEdges(right, 0, 0.3)
  return [left, right]
}

/* -------------------------------------------------------------------------- */
/* Stone                                                                       */
/* -------------------------------------------------------------------------- */

/** Thousands of columns seating themselves. */
function renderStoneRain(seed: number): Float32Array[] {
  const r = random(seed)
  const n = samples(3.6)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  stoneShower(left, right, r, 420, 0.04, 3.2, 1.4)
  return [left, right]
}

/** A wave going through the number. */
function renderRattle(seed: number): Float32Array[] {
  const r = random(seed)
  const n = samples(1.3)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  stoneShower(left, right, r, 130, 0.01, 1.05, 1.5)
  return [left, right]
}

/** One small stone letting go, somewhere in the number. */
function renderPebble(seed: number): Float32Array[] {
  const r = random(seed)
  const n = samples(0.32)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  ping(left, right, 0.003, 900 + r() * 2200, 0.018, 0.7, 0, r)
  ping(left, right, 0.09 + r() * 0.06, 1100 + r() * 2200, 0.012, 0.32, 0, r)
  return [left, right]
}

/** Stone dragging on stone, for as long as the cursor keeps moving over it. Loops. */
function renderGrind(seed: number): Float32Array {
  const r = random(seed)
  const fade = 0.4
  const n = samples(3 + fade)
  const out = new Float32Array(n)
  const band = new Biquad().bandpass(620, 0.9)
  const body = new Biquad().lowpass(240, 0.8)
  const low = brown(r)
  const grit = wander(r, 46)
  const slow = wander(r, 3)
  for (let i = 0; i < n; i++) {
    const gate = Math.max(0, grit() * 0.7 + 0.55 + slow() * 0.2)
    out[i] = (band.run(r() * 2 - 1) * 0.9 + body.run(low()) * 0.8) * gate
  }
  return closeLoop(out, fade)
}

/* -------------------------------------------------------------------------- */
/* Everything else that is alive                                               */
/* -------------------------------------------------------------------------- */

/** High and far off: a harsh, falling cry. */
function renderScreech(seed: number, shape: 'long' | 'double'): Float32Array {
  const formants = { formantsClosed: [1100, 2200, 3400], formantsOpen: [1500, 2900, 4300], widths: [3.4, 5, 6], gains: [1, 0.8, 0.45] }
  if (shape === 'long') {
    return renderVocal({
      ...formants,
      seconds: 1.05,
      seed,
      pitch: [[0, 980], [0.1, 1480], [0.45, 1200], [1.05, 640]],
      level: [[0, 0], [0.06, 1], [0.55, 0.7], [1.05, 0]],
      open: [[0, 0.3], [0.12, 1], [1.05, 0.25]],
      breath: [[0, 0.36], [1.05, 0.55]],
      rough: [[0, 0.6], [0.7, 0.95]],
      flutter: [[0, 0.5], [0.8, 0.85]],
      flutterRate: 118,
      bend: 0.16,
      chest: 0,
      drive: 3,
    })
  }
  return renderVocal({
    ...formants,
    seconds: 0.75,
    seed,
    pitch: [[0, 1200], [0.08, 1640], [0.27, 1080], [0.34, 1340], [0.46, 1560], [0.75, 880]],
    level: [[0, 0], [0.05, 1], [0.25, 0.7], [0.3, 0.08], [0.37, 0.92], [0.75, 0]],
    open: [[0, 0.5], [0.1, 1], [0.3, 0.3], [0.4, 1], [0.75, 0.3]],
    breath: [[0, 0.38]],
    rough: [[0, 0.7], [0.75, 0.95]],
    flutter: [[0, 0.6]],
    flutterRate: 134,
    bend: 0.18,
    chest: 0,
    drive: 3,
  })
}

/** A wing coming down: a soft thump of displaced air. */
function renderWing(seed: number): Float32Array {
  const r = random(seed)
  const n = samples(0.4)
  const out = new Float32Array(n)
  const filter = new Biquad()
  for (let i = 0; i < n; i++) {
    const u = i / n
    if (i % 32 === 0) filter.bandpass(420 - u * 280, 0.8)
    out[i] = filter.run(r() * 2 - 1) * Math.sin(Math.PI * u) ** 3
  }
  return out
}

function bubble(out: Float32Array, start: number, frequency: number, rise: number, decay: number, amplitude: number): void {
  const from = samples(start)
  const to = Math.min(out.length, from + samples(decay * 7))
  let phase = 0
  for (let i = from; i < to; i++) {
    const t = (i - from) / RATE
    phase += (frequency * (1 + rise * t)) / RATE
    out[i]! += Math.sin(TAU * phase) * amplitude * Math.exp(-t / decay) * (1 - Math.exp(-t / 0.0015))
  }
}

/** A turtle breathing out underwater. */
function renderBubbles(seed: number): Float32Array {
  const r = random(seed)
  const out = new Float32Array(samples(1))
  for (let i = 0; i < 9; i++) bubble(out, 0.02 + r() * 0.72, 340 + r() ** 1.5 * 1100, 2 + r() * 5, 0.018 + r() * 0.03, 0.35 + r() * 0.65)
  return out
}

/** Lava, slowly: a thick bubble coming up and giving way. */
function renderBlub(seed: number): Float32Array {
  const r = random(seed)
  const out = new Float32Array(samples(0.38))
  bubble(out, 0.005, 105 + r() * 60, 7 + r() * 5, 0.06 + r() * 0.03, 1)
  bubble(out, 0.005, 310 + r() * 120, 6, 0.03, 0.34)
  bubble(out, 0.07 + r() * 0.05, 190 + r() * 150, 8, 0.024, 0.42)
  return out
}

/** A turtle going through the zero. Something ought to mark the occasion. */
function renderChime(seed: number): Float32Array[] {
  const r = random(seed)
  const n = samples(2.6)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  const notes = [523.25, 659.25, 783.99, 987.77, 1318.51, 1567.98]
  notes.forEach((note, index) => {
    const start = index * 0.09
    const detune = 1 + (r() - 0.5) * 0.004
    const pan = Math.sin(index * 2.2) * 0.7
    const gainL = Math.cos(((pan + 1) * Math.PI) / 4)
    const gainR = Math.sin(((pan + 1) * Math.PI) / 4)
    const amplitude = 0.5 / (1 + index * 0.35)
    for (let i = samples(start); i < n; i++) {
      const t = i / RATE - start
      const value = (Math.sin(TAU * note * detune * t) + Math.sin(TAU * note * 2.001 * t) * 0.18) * (1 - Math.exp(-t / 0.02)) * Math.exp(-t / 0.62) * amplitude
      left[i]! += value * gainL
      right[i]! += value * gainR
    }
  })
  return [left, right]
}

/** What is always there: the ground, the wind, the fire and a low dread. Loops. */
function renderBed(seed: number): Float32Array[] {
  const r = random(seed)
  const fade = 2
  const n = samples(16 + fade)
  const channels = [new Float32Array(n), new Float32Array(n)]
  channels.forEach((channel, side) => {
    const rumble = new Biquad().lowpass(105 + side * 12, 0.7)
    const wind = new Biquad()
    const crackle = new Biquad().highpass(2200, 0.7)
    const low = brown(r)
    const air = pink(r)
    const swell = wander(r, 0.19)
    const gust = wander(r, 0.14)
    const sweep = wander(r, 0.11)
    const shimmer = wander(r, 0.07)
    let spark = 0
    for (let i = 0; i < n; i++) {
      const t = i / RATE
      if (i % 64 === 0) wind.bandpass(470 + sweep() * 240, 0.9)
      const ground = rumble.run(low()) * (1.1 + swell() * 0.5)
      const breeze = wind.run(air()) * (0.5 + gust() * 0.4) * 1.5
      // Two sines a little apart beat slowly; the others are the fifth and octave.
      const drone =
        (Math.sin(TAU * 55 * t + side) + Math.sin(TAU * 55.3 * t) * 0.8 + Math.sin(TAU * 82.6 * t) * 0.34 + Math.sin(TAU * 110.25 * t + side * 2) * 0.22) *
        (0.13 + shimmer() * 0.05)
      if (r() < 0.00022) spark = 0.25 + r() ** 3 * 2.4
      const tick = crackle.run((r() * 2 - 1) * spark)
      spark *= 0.992
      channel[i] = ground + breeze + drone + tick * 1.1
    }
  })
  return normalize(channels.map((channel) => closeLoop(channel, fade)), 0.8)
}

/** The place itself: a very large, very dark canyon, as an impulse response. */
function renderReverb(seed: number): Float32Array[] {
  const r = random(seed)
  const n = samples(3.4)
  const channels = [new Float32Array(n), new Float32Array(n)]
  channels.forEach((channel, side) => {
    let dark = 0
    for (let i = 0; i < n; i++) {
      const t = i / RATE
      const coefficient = 1 - Math.exp((-TAU * (500 + 8500 * Math.exp(-t / 0.55))) / RATE)
      dark += ((r() * 2 - 1) - dark) * coefficient
      channel[i] = dark * Math.exp(-t / 0.5) * (1 - Math.exp(-t / 0.012))
    }
    // A few walls close enough to hear individually.
    for (const [delay, level] of [[0.023, 0.7], [0.047, 0.55], [0.081, 0.42], [0.127, 0.3]] as const) {
      channel[samples(delay + side * 0.0041)]! += level * (side ? -1 : 1)
    }
  })
  return normalize(channels, 0.95)
}

/* -------------------------------------------------------------------------- */
/* The catalogue                                                               */
/* -------------------------------------------------------------------------- */

const peak = (channel: Float32Array, value: number): Float32Array[] => normalize([fadeEdges(channel, 0.002, 0.02)], value)

/** Every voice, by name. Most important first: the worker renders in this order. */
export const VOICES = {
  roar: () => peak(renderRoar(11, 1, 1), 0.97),
  stompA: () => peak(renderStomp(21), 0.95),
  stompB: () => peak(renderStomp(22), 0.95),
  stompC: () => peak(renderStomp(23), 0.95),
  whooshLong: () => peak(renderWhoosh(31, 1.05), 0.9),
  whooshShort: () => peak(renderWhoosh(32, 0.55), 0.9),
  impactBig: () => normalize(renderImpact(41, 7, 1.35), 0.97),
  impactMid: () => normalize(renderImpact(42, 4, 0.8), 0.95),
  stoneRain: () => normalize(renderStoneRain(51), 0.9),
  rattle: () => normalize(renderRattle(52), 0.9),
  reverb: () => renderReverb(61),
  bed: () => renderBed(71),
  roarShort: () => peak(renderRoar(12, 0.72, 1.12), 0.97),
  snarl: () => peak(renderSnarl(13), 0.95),
  growl: () => peak(renderGrowl(14), 0.92),
  snort: () => peak(renderSnort(15), 0.85),
  chomp: () => peak(renderChomp(16), 0.95),
  crunchA: () => peak(renderCrunch(17), 0.9),
  crunchB: () => peak(renderCrunch(18), 0.9),
  gulp: () => peak(renderGulp(19), 0.9),
  yawn: () => peak(renderYawn(20), 0.92),
  sniff: () => peak(renderSniff(24), 0.75),
  swish: () => peak(renderSwish(25), 0.8),
  screechLong: () => peak(renderScreech(81, 'long'), 0.9),
  screechDouble: () => peak(renderScreech(82, 'double'), 0.9),
  wing: () => peak(renderWing(83), 0.8),
  bubbles: () => peak(renderBubbles(91), 0.85),
  blubA: () => peak(renderBlub(92), 0.9),
  blubB: () => peak(renderBlub(93), 0.9),
  chime: () => normalize(renderChime(94), 0.85),
  pebbleA: () => normalize(renderPebble(53), 0.85),
  pebbleB: () => normalize(renderPebble(54), 0.85),
  grind: () => peak(renderGrind(55), 0.85),
  farStreak: () => peak(renderFarStreak(33), 0.8),
} as const satisfies Record<string, () => Float32Array[]>

export type VoiceName = keyof typeof VOICES

export const VOICE_NAMES = Object.keys(VOICES) as VoiceName[]

/** Voices that are played as continuous loops, which `peak`'s fades would ruin. */
export const LOOPS: readonly VoiceName[] = ['bed', 'grind']
