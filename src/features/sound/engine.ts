import { RATE } from './dsp'
// Types only: the bank itself is imported dynamically, so it stays out of the
// page's chunk until there is a sound to make. A static import of one number
// from it pulled the whole bank back in, and the build said so.
import type { BankName, LoopName, VoiceName } from './voices'
import type { VoiceMessage, VoiceRequest } from './voices.worker'

/**
 * Plays what `voices.ts` renders: a small mixing desk in Web Audio.
 *
 *   voice → pan → gain ─┬─────────────► bus ─► glue ─► limiter ─► master
 *                       └─► send ─► canyon reverb ─────┘
 *
 * Everything is panned to where it is on screen, and whatever is loud pushes the
 * ambience down out of its way. Separate from the store so that none of it is
 * in the page's first download.
 *
 * Each page has a bank of its own (see `BANKS`), and two kinds of sound: cues,
 * which are one-shots fired at a moment, and loops, which run all the time and
 * are only ever turned up and down by the scene.
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
  // The valley.
  | { kind: 'call'; species: 'sauropod' | 'stegosaur' | 'pterosaur' | 'rex'; pan: number; distance: number; alarm?: boolean }
  | { kind: 'dying'; pan: number; distance: number }
  | { kind: 'entry'; seconds: number }
  | { kind: 'sonicBoom' }
  | { kind: 'flash' }
  | { kind: 'blast' }
  | { kind: 'airBlast' }
  | { kind: 'debris'; pan: number }
  | { kind: 'fall'; pan: number; size: number }
  | { kind: 'thunder'; pan: number; near: boolean }
  | { kind: 'dawn' }

export interface SoundEngine {
  /** Hands over the context, once a gesture has made one possible, and starts the loops. */
  attach(context: AudioContext): void
  cue(cue: Cue): void
  /** How loud a loop is, 0..1, and where it sits. */
  level(name: LoopName, value: number, pan?: number): void
  muted(muted: boolean): void
}

type Bus = 'rex' | 'sky' | 'stone' | 'life' | 'bed'

/** Levels of the groups against each other; the voices themselves are all normalised. */
const BUS_LEVEL: Record<Bus, number> = { rex: 1, sky: 0.95, stone: 0.5, life: 0.55, bed: 0.46 }

/** Comes in below full level on purpose: nobody chose how loud their speakers were left. */
const MASTER = 0.62

/** Beyond this many sounding at once the oldest are let go. */
const MOST_VOICES = 30

/** Which group each loop belongs to, and how loud it is at full. */
const LOOP: Record<LoopName, { bus: Bus; gain: number }> = {
  bed: { bus: 'bed', gain: 1 },
  grind: { bus: 'stone', gain: 0.5 },
  valleyAir: { bus: 'bed', gain: 1 },
  fire: { bus: 'bed', gain: 0.8 },
  ashWind: { bus: 'bed', gain: 1 },
}

/** What each page starts with, before its scene has said anything. */
const BANK_SETUP: Record<BankName, { levels: Partial<Record<LoopName, number>>; tick: boolean }> = {
  notFound: { levels: { bed: 1 }, tick: true },
  valley: { levels: {}, tick: false },
}

interface PlayOptions {
  bus: Bus
  gain: number
  rate?: number
  /** Plays it at whatever rate makes it last this many seconds, in place of `rate`. */
  lasting?: number
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
}

interface Loop {
  gain: GainNode
  pan: StereoPannerNode | null
}

export function createEngine(bank: BankName): SoundEngine {
  const setup = BANK_SETUP[bank]
  const rendered = new Map<VoiceName, Float32Array[]>()
  const ready = new Map<VoiceName, AudioBuffer>()
  const sounding: { source: AudioBufferSourceNode; bus: Bus }[] = []
  const loops = new Map<LoopName, Loop>()
  /** What the scene last asked of each loop, kept for a loop that has not started yet. */
  const levels = new Map<LoopName, { value: number; pan: number }>(
    Object.entries(setup.levels).map(([name, value]) => [name as LoopName, { value, pan: 0 }]),
  )
  let graph: Graph | null = null
  let isMuted = false
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
    for (const name of Object.keys(LOOP) as LoopName[]) {
      if (loops.has(name)) continue
      const buffer = asBuffer(name, context)
      if (!buffer) continue
      // Running from the start, at whatever level has been asked for: a loop
      // that is turned up later comes in mid-phrase, the way ambience does.
      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const gain = context.createGain()
      gain.gain.value = 0
      const pan = 'createStereoPanner' in context ? context.createStereoPanner() : null
      ;(pan ? source.connect(pan) : source).connect(gain).connect(buses[LOOP[name].bus])
      source.start()
      loops.set(name, { gain, pan })
      applyLevel(name, 0.7)
    }
  }

  /** Moves a loop towards what was last asked of it, over roughly `over` seconds. */
  const applyLevel = (name: LoopName, over = 0.25) => {
    const loop = loops.get(name)
    const wanted = levels.get(name)
    if (!graph || !loop) return
    const now = graph.context.currentTime
    loop.gain.gain.setTargetAtTime((wanted?.value ?? 0) * LOOP[name].gain, now, over / 3)
    loop.pan?.pan.setTargetAtTime(wanted?.pan ?? 0, now, 0.05)
  }

  const receive = (name: VoiceName, channels: Float32Array[]) => {
    rendered.set(name, channels)
    settle()
  }

  // ---- Voices arrive from the worker; if there can be no worker, from here -----
  const renderHere = async () => {
    const { VOICES, BANKS } = await import('./voices')
    for (const name of BANKS[bank]) {
      if (rendered.has(name)) continue
      await new Promise((done) => setTimeout(done, 30))
      receive(name, VOICES[name]())
    }
  }
  try {
    const worker = new Worker(new URL('./voices.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<VoiceMessage>) => receive(event.data.name, event.data.channels)
    worker.onerror = () => void renderHere()
    const request: VoiceRequest = { bank }
    worker.postMessage(request)
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
    source.playbackRate.value = options.lasting ? buffer.duration / options.lasting : (options.rate ?? 1)

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

  /**
   * Everything but the sky gone for a moment, the way hearing goes when
   * something lands close: only what is on the sky bus, the ring and the blast
   * behind it, gets through, and the rest comes back slowly.
   */
  const deafen = (hold: number): void => {
    if (!graph) return
    const { context, buses } = graph
    const now = context.currentTime
    for (const name of ['rex', 'stone', 'life', 'bed'] as const) {
      const level = buses[name].gain
      level.cancelScheduledValues(now)
      level.setTargetAtTime(BUS_LEVEL[name] * 0.04, now, 0.015)
      level.setTargetAtTime(BUS_LEVEL[name], now + hold, 0.9)
    }
  }

  /** Further off is quieter, duller, and more of it is the canyon. */
  const far = (distance: number) => ({ gain: 1 - distance * 0.55, lowpass: 9000 - distance * 6500, send: 0.5 + distance * 0.35 })

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

  /** Whatever the scene has asked of the loops, for a context that has just arrived. */
  const applyAll = () => {
    for (const name of loops.keys()) applyLevel(name)
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

      graph = { context, master, reverb, buses }
      settle()
      applyAll()
      if (setup.tick) startTicking()
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

        // ---- The valley ----------------------------------------------------
        case 'call': {
          const { gain, lowpass, send } = far(cue.distance)
          const voice =
            cue.species === 'sauropod'
              ? cue.alarm
                ? 'sauropodHonk'
                : 'sauropodCall'
              : cue.species === 'stegosaur'
                ? 'stegoGrunt'
                : cue.species === 'pterosaur'
                  ? pick(['screechLong', 'screechDouble'] as const)
                  : cue.alarm
                    ? 'snarl'
                    : 'roar'
          const level = cue.species === 'rex' ? 0.75 : cue.species === 'pterosaur' ? 0.5 : 0.85
          play(voice, { bus: 'life', gain: level * gain, rate: between(0.92, 1.08), pan: cue.pan, send, lowpass })
          break
        }
        case 'dying': {
          const { gain, lowpass, send } = far(cue.distance)
          play('sauropodMoan', { bus: 'life', gain: 0.8 * gain, rate: between(0.9, 1.05), pan: cue.pan, send, lowpass })
          break
        }
        case 'entry':
          // Loud, but not as loud as what it does when it lands.
          // Stretched to end on the impact, however long the streak is.
          play('entry', { bus: 'sky', gain: 0.72, lasting: cue.seconds, pan: -0.75, panTo: 0.15, panOver: cue.seconds, send: 0.35 })
          duck(0.5, cue.seconds)
          break
        case 'sonicBoom':
          play('sonicBoom', { bus: 'sky', gain: 0.8, pan: 0.1, send: 0.6 })
          break
        case 'flash':
          deafen(1.1)
          play('flashRing', { bus: 'sky', gain: 0.9, send: 0.1 })
          break
        case 'blast':
          play('blastBoom', { bus: 'sky', gain: 1, pan: 0.1, send: 0.55 })
          duck(0.9, 3)
          break
        case 'airBlast':
          play('airBlast', { bus: 'sky', gain: 0.95, send: 0.25 })
          break
        case 'debris':
          play('debrisFall', { bus: 'stone', gain: 0.9, pan: cue.pan, send: 0.4 })
          break
        case 'fall':
          play(pick(['stompA', 'stompB'] as const), { bus: 'rex', gain: 0.35 + cue.size * 0.45, rate: between(0.55, 0.7), pan: cue.pan, send: 0.45, lowpass: 2500 })
          break
        case 'thunder':
          play(cue.near ? 'thunderNear' : 'thunderFar', { bus: 'sky', gain: cue.near ? 0.9 : 0.6, pan: cue.pan, send: 0.5 })
          break
        case 'dawn':
          play('dawn', { bus: 'life', gain: 0.55, send: 0.6 })
          break
      }
    },

    level(name, value, pan = 0) {
      levels.set(name, { value, pan })
      applyLevel(name)
    },

    muted(muted) {
      isMuted = muted
      if (!graph) return
      const now = graph.context.currentTime
      graph.master.gain.cancelScheduledValues(now)
      graph.master.gain.setTargetAtTime(muted ? 0 : MASTER, now, 0.08)
      if (!muted && setup.tick) startTicking()
    },
  }
}
