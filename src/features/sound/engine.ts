import { RATE } from './dsp'
import type { VoiceName } from './voices'
import type { VoiceMessage } from './voices.worker'

/**
 * Plays what `voices.ts` renders: a small mixing desk in Web Audio.
 *
 *   voice → pan → gain ─┬─────────────► bus ─► glue ─► limiter ─► master
 *                       └─► send ─► canyon reverb ─────┘
 *
 * Everything is panned to where it is on screen, and whatever is loud pushes the
 * ambience down out of its way. Separate from the store so that none of it is
 * in the page's first download.
 */

export type Cue =
  | { kind: 'meteor'; flight: number; from: number; to: number; power: number }
  | { kind: 'impact'; pan: number; power: number; first: boolean }
  | { kind: 'stones' }
  | { kind: 'rattle'; pan: number; power: number }
  | { kind: 'footfall'; pan: number; power: number }
  | { kind: 'roar'; pan: number; short: boolean }
  | { kind: 'snarl'; pan: number }
  | { kind: 'growl'; pan: number }
  | { kind: 'snort'; pan: number }
  | { kind: 'chomp'; pan: number; quiet?: boolean }
  | { kind: 'crunch'; pan: number }
  | { kind: 'gulp'; pan: number }
  | { kind: 'yawn'; pan: number }
  | { kind: 'sniff'; pan: number }
  | { kind: 'swish'; pan: number }
  | { kind: 'slam'; pan: number }
  | { kind: 'screech'; pan: number }
  | { kind: 'wing'; pan: number }
  | { kind: 'bubbles'; pan: number }
  | { kind: 'portal'; pan: number }
  | { kind: 'farStreak'; pan: number }

export interface SoundEngine {
  /** Hands over the context, once a gesture has made one possible, and starts the bed. */
  attach(context: AudioContext): void
  cue(cue: Cue): void
  /** Stone dragging under the cursor: 0..1, and where. */
  grind(level: number, pan: number): void
  muted(muted: boolean): void
}

type Bus = 'rex' | 'sky' | 'stone' | 'life' | 'bed'

/** Levels of the groups against each other; the voices themselves are all normalised. */
const BUS_LEVEL: Record<Bus, number> = { rex: 1, sky: 0.95, stone: 0.5, life: 0.55, bed: 0.46 }

/** Comes in below full level on purpose: nobody chose how loud their speakers were left. */
const MASTER = 0.62

/** Beyond this many sounding at once the oldest are let go. */
const MOST_VOICES = 30

interface PlayOptions {
  bus: Bus
  gain: number
  rate?: number
  pan?: number
  /** Pans from `pan` to here over `panOver` seconds. */
  panTo?: number
  panOver?: number
  /** How much goes to the reverb. */
  send?: number
  /** A lowpass, for things that are a long way off. */
  lowpass?: number
}

/** Linear interpolation is plenty for an impulse response, which is mostly noise. */
function resampled(channel: Float32Array, rate: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round((channel.length * rate) / RATE))
  for (let i = 0; i < out.length; i++) {
    const x = (i * RATE) / rate
    const whole = Math.floor(x)
    const part = x - whole
    out[i] = (channel[whole] ?? 0) * (1 - part) + (channel[whole + 1] ?? 0) * part
  }
  return out
}

const between = (low: number, high: number): number => low + Math.random() * (high - low)
const pick = <T,>(options: readonly T[]): T => options[Math.floor(Math.random() * options.length)]!

interface Graph {
  context: AudioContext
  master: GainNode
  reverb: ConvolverNode
  buses: Record<Bus, GainNode>
  grindGain: GainNode | null
  grindPan: StereoPannerNode | null
}

export function createEngine(): SoundEngine {
  const rendered = new Map<VoiceName, Float32Array[]>()
  const ready = new Map<VoiceName, AudioBuffer>()
  const sounding: { source: AudioBufferSourceNode; bus: Bus }[] = []
  let graph: Graph | null = null
  let isMuted = false
  let bedStarted = false
  let ticking = false

  const asBuffer = (name: VoiceName, context: AudioContext): AudioBuffer | null => {
    const cached = ready.get(name)
    if (cached) return cached
    const channels = rendered.get(name)
    if (!channels) return null
    const buffer = context.createBuffer(channels.length, channels[0]!.length, RATE)
    channels.forEach((channel, i) => buffer.getChannelData(i).set(channel))
    ready.set(name, buffer)
    rendered.delete(name)
    return buffer
  }

  /** Wires up whatever has turned up: called when a voice lands and on attach. */
  const settle = () => {
    if (!graph) return
    const { context, reverb, buses } = graph
    const impulse = rendered.get('reverb')
    if (!reverb.buffer && impulse) {
      // Unlike every other buffer, a convolver's must be at the context's own rate
      // or it throws, and most devices are not at 44.1 kHz.
      const buffer = context.createBuffer(impulse.length, Math.round((impulse[0]!.length * context.sampleRate) / RATE), context.sampleRate)
      impulse.forEach((channel, i) => buffer.getChannelData(i).set(resampled(channel, context.sampleRate)))
      reverb.buffer = buffer
      rendered.delete('reverb')
    }
    if (!bedStarted) {
      const bed = asBuffer('bed', context)
      if (bed) {
        bedStarted = true
        const source = context.createBufferSource()
        source.buffer = bed
        source.loop = true
        const fadeIn = context.createGain()
        fadeIn.gain.setValueAtTime(0, context.currentTime)
        fadeIn.gain.linearRampToValueAtTime(1, context.currentTime + 2.2)
        source.connect(fadeIn).connect(buses.bed)
        source.start()
      }
    }
    if (!graph.grindGain && 'createStereoPanner' in context) {
      const grinding = asBuffer('grind', context)
      if (grinding) {
        const source = context.createBufferSource()
        source.buffer = grinding
        source.loop = true
        const gain = context.createGain()
        gain.gain.value = 0
        const pan = context.createStereoPanner()
        source.connect(pan).connect(gain).connect(buses.stone)
        source.start()
        graph.grindGain = gain
        graph.grindPan = pan
      }
    }
  }

  const receive = (name: VoiceName, channels: Float32Array[]) => {
    rendered.set(name, channels)
    settle()
  }

  // ---- Voices arrive from the worker; if there can be no worker, from here -----
  const renderHere = async () => {
    const { VOICES, VOICE_NAMES } = await import('./voices')
    for (const name of VOICE_NAMES) {
      if (rendered.has(name)) continue
      await new Promise((done) => setTimeout(done, 30))
      receive(name, VOICES[name]())
    }
  }
  try {
    const worker = new Worker(new URL('./voices.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<VoiceMessage>) => receive(event.data.name, event.data.channels)
    worker.onerror = () => void renderHere()
  } catch {
    void renderHere()
  }

  const play = (name: VoiceName, options: PlayOptions): void => {
    // A suspended context would save every cue up and play them all at once on waking.
    if (!graph || isMuted || graph.context.state !== 'running') return
    const { context, reverb, buses } = graph
    const buffer = asBuffer(name, context)
    if (!buffer) return

    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = options.rate ?? 1

    let chain: AudioNode = source
    if (options.lowpass) {
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = options.lowpass
      chain = chain.connect(filter)
    }
    // Missing before Safari 14.1, where everything simply comes from the middle.
    if ('createStereoPanner' in context) {
      const panner = context.createStereoPanner()
      panner.pan.value = options.pan ?? 0
      if (options.panTo !== undefined) {
        panner.pan.setValueAtTime(options.pan ?? 0, context.currentTime)
        panner.pan.linearRampToValueAtTime(options.panTo, context.currentTime + (options.panOver ?? 1))
      }
      chain = chain.connect(panner)
    }

    const gain = context.createGain()
    gain.gain.value = options.gain
    chain.connect(gain).connect(buses[options.bus])
    if (options.send) {
      const send = context.createGain()
      send.gain.value = options.gain * options.send
      chain.connect(send).connect(reverb)
    }

    const entry = { source, bus: options.bus }
    sounding.push(entry)
    source.onended = () => {
      const at = sounding.indexOf(entry)
      if (at >= 0) sounding.splice(at, 1)
      chain.disconnect()
      gain.disconnect()
    }
    if (sounding.length > MOST_VOICES) {
      // Never the animal: the crowd can lose a pebble, nobody can lose the roar.
      const victim = sounding.find((candidate) => candidate.bus !== 'rex')
      victim?.source.stop()
    }
    source.start()
  }

  /** Pushes the ambience down for something loud, then lets it back. */
  const duck = (amount: number, hold: number): void => {
    if (!graph) return
    const { context, buses } = graph
    const level = buses.bed.gain
    const now = context.currentTime
    level.cancelScheduledValues(now)
    level.setTargetAtTime(BUS_LEVEL.bed * (1 - amount), now, 0.05)
    level.setTargetAtTime(BUS_LEVEL.bed, now + hold, 0.9)
  }

  /** The small, irregular life of the place: lava giving way, a stone letting go. */
  const tick = () => {
    if (!graph || isMuted) {
      ticking = false
      return
    }
    if (Math.random() < 0.55) {
      play(pick(['blubA', 'blubB'] as const), { bus: 'bed', gain: between(0.35, 1), rate: between(0.8, 1.25), pan: between(-0.8, 0.8), send: 0.4 })
    } else {
      play(pick(['pebbleA', 'pebbleB'] as const), { bus: 'stone', gain: between(0.12, 0.42), rate: between(0.8, 1.3), pan: between(-0.7, 0.7), send: 0.45 })
    }
    window.setTimeout(tick, between(450, 2100))
  }

  const startTicking = () => {
    if (ticking) return
    ticking = true
    window.setTimeout(tick, 900)
  }

  return {
    attach(context) {
      if (graph) return
      const glue = context.createDynamicsCompressor()
      glue.threshold.value = -12
      glue.knee.value = 14
      glue.ratio.value = 3.5
      glue.attack.value = 0.008
      glue.release.value = 0.22
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -2.5
      limiter.knee.value = 0
      limiter.ratio.value = 20
      limiter.attack.value = 0.002
      limiter.release.value = 0.1
      const master = context.createGain()
      master.gain.setValueAtTime(0, context.currentTime)
      master.gain.linearRampToValueAtTime(isMuted ? 0 : MASTER, context.currentTime + 0.5)
      glue.connect(limiter).connect(master).connect(context.destination)

      const reverb = context.createConvolver()
      const wet = context.createGain()
      wet.gain.value = 0.8
      reverb.connect(wet).connect(glue)

      const buses = Object.fromEntries(
        (Object.keys(BUS_LEVEL) as Bus[]).map((name) => {
          const gain = context.createGain()
          gain.gain.value = BUS_LEVEL[name]
          gain.connect(glue)
          return [name, gain]
        }),
      ) as Record<Bus, GainNode>

      graph = { context, master, reverb, buses, grindGain: null, grindPan: null }
      settle()
      startTicking()
    },

    cue(cue) {
      switch (cue.kind) {
        case 'meteor': {
          const name = cue.flight > 0.75 ? 'whooshLong' : 'whooshShort'
          const length = name === 'whooshLong' ? 1.05 : 0.55
          play(name, { bus: 'sky', gain: 0.62 * cue.power, rate: length / cue.flight, pan: cue.from, panTo: cue.to, panOver: cue.flight, send: 0.3 })
          break
        }
        case 'impact':
          play(cue.first ? 'impactBig' : 'impactMid', { bus: 'sky', gain: cue.first ? 1 : Math.min(1, 0.72 * cue.power + 0.28), rate: cue.first ? 1 : between(0.93, 1.08), pan: cue.pan * 0.55, send: 0.6 })
          play('rattle', { bus: 'stone', gain: 0.9, rate: between(0.92, 1.08), pan: cue.pan * 0.8, send: 0.3 })
          duck(0.8, cue.first ? 2.6 : 1.5)
          break
        case 'stones':
          play('stoneRain', { bus: 'stone', gain: 1, pan: 0, send: 0.34 })
          break
        case 'rattle':
          play('rattle', { bus: 'stone', gain: 0.75 * cue.power, rate: between(0.9, 1.12), pan: cue.pan, send: 0.32 })
          break
        case 'footfall':
          play(pick(['stompA', 'stompB', 'stompC'] as const), { bus: 'rex', gain: 0.74 * (0.45 + cue.power * 0.55), rate: between(0.93, 1.07), pan: cue.pan * 0.7, send: 0.2 })
          duck(0.22, 0.08)
          break
        case 'roar':
          play(cue.short ? 'roarShort' : 'roar', { bus: 'rex', gain: 1, rate: between(0.97, 1.03), pan: cue.pan * 0.5, send: 0.62 })
          duck(0.7, cue.short ? 1.6 : 2.4)
          break
        case 'snarl':
          play('snarl', { bus: 'rex', gain: 0.78, rate: between(0.92, 1.1), pan: cue.pan * 0.5, send: 0.48 })
          duck(0.4, 0.8)
          break
        case 'growl':
          play('growl', { bus: 'rex', gain: 0.6, rate: between(0.9, 1.1), pan: cue.pan * 0.5, send: 0.3 })
          break
        case 'snort':
          play('snort', { bus: 'rex', gain: 0.38, rate: between(0.88, 1.12), pan: cue.pan * 0.5, send: 0.3 })
          break
        case 'chomp':
          play('chomp', { bus: 'rex', gain: cue.quiet ? 0.32 : 0.82, rate: between(0.94, 1.08), pan: cue.pan * 0.5, send: 0.3 })
          break
        case 'crunch':
          play(pick(['crunchA', 'crunchB'] as const), { bus: 'rex', gain: 0.5, rate: between(0.88, 1.12), pan: cue.pan * 0.5, send: 0.22 })
          break
        case 'gulp':
          play('gulp', { bus: 'rex', gain: 0.66, rate: between(0.95, 1.05), pan: cue.pan * 0.5, send: 0.2 })
          break
        case 'yawn':
          play('yawn', { bus: 'rex', gain: 0.62, pan: cue.pan * 0.5, send: 0.4 })
          break
        case 'sniff':
          play('sniff', { bus: 'rex', gain: 0.3, rate: between(0.9, 1.15), pan: cue.pan * 0.5, send: 0.18 })
          break
        case 'swish':
          play('swish', { bus: 'rex', gain: 0.42, rate: between(0.9, 1.1), pan: cue.pan * 0.6, send: 0.3 })
          break
        case 'slam':
          play(pick(['stompA', 'stompB', 'stompC'] as const), { bus: 'rex', gain: 1, rate: between(0.74, 0.84), pan: cue.pan * 0.7, send: 0.34 })
          duck(0.4, 0.3)
          break
        case 'screech':
          play(pick(['screechLong', 'screechDouble'] as const), { bus: 'life', gain: between(0.3, 0.46), rate: between(0.86, 1.14), pan: cue.pan, send: 0.75, lowpass: 5200 })
          break
        case 'wing':
          play('wing', { bus: 'life', gain: 0.16, rate: between(0.9, 1.1), pan: cue.pan, send: 0.3 })
          break
        case 'bubbles':
          play('bubbles', { bus: 'life', gain: between(0.3, 0.5), rate: between(0.82, 1.2), pan: cue.pan, send: 0.35 })
          break
        case 'portal':
          play('chime', { bus: 'life', gain: 0.5, pan: cue.pan, send: 0.7 })
          play('bubbles', { bus: 'life', gain: 0.5, rate: 1.1, pan: cue.pan, send: 0.4 })
          break
        case 'farStreak':
          play('farStreak', { bus: 'sky', gain: 0.1, rate: between(0.85, 1.2), pan: cue.pan, send: 0.55 })
          break
      }
    },

    grind(level, pan) {
      if (!graph?.grindGain || !graph.grindPan) return
      const now = graph.context.currentTime
      graph.grindGain.gain.setTargetAtTime(isMuted ? 0 : level * 0.5, now, 0.07)
      graph.grindPan.pan.setTargetAtTime(pan, now, 0.05)
    },

    muted(muted) {
      isMuted = muted
      if (!graph) return
      const now = graph.context.currentTime
      graph.master.gain.cancelScheduledValues(now)
      graph.master.gain.setTargetAtTime(muted ? 0 : MASTER, now, 0.08)
      if (!muted) startTicking()
    },
  }
}
