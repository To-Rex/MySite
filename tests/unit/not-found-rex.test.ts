import { describe, expect, it } from 'vitest'
import { ACTS, ACT_NAMES, IDLE_ORDER, POKE_ORDER, ROAR_RISE, ROAR_WIND, newPose, takesRequest, turnFacingCamera, walkHeading, type ActInProgress, type RexPose } from '@/components/three/notFoundRexActs'

/**
 * What the tyrannosaur does, as numbers. Whether it looks right is a job for
 * `npm run shots`; whether an act ends where it started, whether the mouth is
 * open when it should be and whether each bang happens when something lands is
 * arithmetic, and that is what breaks when someone adjusts a timing.
 */

const at = (name: keyof typeof ACTS, s: number): RexPose => {
  const pose = newPose()
  ACTS[name].pose(s, pose)
  return pose
}

describe.each(ACT_NAMES)('the act %s', (name) => {
  const act = ACTS[name]
  const steps = Array.from({ length: 200 }, (_, i) => (i / 199) * act.seconds)

  it('is real numbers, all the way through', () => {
    for (const s of steps) for (const value of Object.values(at(name, s))) expect(Number.isFinite(value)).toBe(true)
  })

  it('keeps every channel inside what the skeleton can do', () => {
    for (const s of steps) {
      for (const [channel, value] of Object.entries(at(name, s))) {
        expect(value, `${channel} at ${s}`).toBeGreaterThanOrEqual(-1)
        expect(value, `${channel} at ${s}`).toBeLessThanOrEqual(1.1)
      }
    }
  })

  it('ends where it began, so the next thing does not start with a jolt', () => {
    for (const [channel, value] of Object.entries(at(name, act.seconds))) expect(value, channel).toBeCloseTo(0, 1)
  })

  it('has its moments in order, inside its own length', () => {
    let last = -1
    for (const { at: when } of act.beats) {
      expect(when).toBeGreaterThanOrEqual(last)
      expect(when).toBeLessThanOrEqual(act.seconds)
      last = when
    }
  })
})

describe('the roar', () => {
  it('winds up first: head down, mouth nearly shut', () => {
    const windUp = at('roar', ROAR_WIND - 0.02)
    expect(windUp.crouch).toBeGreaterThan(0.8)
    expect(windUp.jaw).toBeLessThan(0.3)
  })

  it('has its mouth wide open and its head up while the voice is going', () => {
    const peak = at('roar', 1.2)
    expect(peak.jaw).toBeGreaterThan(0.8)
    expect(peak.rear).toBeGreaterThan(0.9)
  })

  it('lets the sound out as the head comes up', () => {
    const out = ACTS.roar.beats.find((beat) => beat.beat === 'roarOut')!
    expect(out.at).toBeCloseTo(ROAR_WIND + ROAR_RISE, 5)
    expect(at('roar', out.at).rear).toBeGreaterThan(0.9)
  })

  it('starts with the breath in, which is how the recording starts', () => {
    expect(ACTS.roar.beats[0]).toEqual({ at: 0, beat: 'breathIn' })
  })
})

describe('biting', () => {
  it('shuts its jaws at the moment of the snap', () => {
    expect(at('snap', 0.13).jaw).toBeGreaterThan(0.9)
    const chomp = ACTS.snap.beats.find((beat) => beat.beat === 'chomp')!.at
    // The clack is the jaws meeting, so they have to be open just before it.
    expect(at('snap', chomp - 0.08).jaw).toBeGreaterThan(0.5)
    expect(at('snap', chomp + 0.03).jaw).toBeLessThan(0.15)
  })

  it('has its mouth open going in and shut once it has hold', () => {
    const bite = ACTS.bite.beats.find((beat) => beat.beat === 'bite')!.at
    expect(at('bite', bite - 0.08).jaw).toBeGreaterThan(0.9)
    expect(at('bite', bite + 0.08).jaw).toBeLessThan(0.1)
  })

  it('walks up to the number before any of that', () => {
    expect(ACTS.bite.approach).toBe('number')
  })

  it('chews: the jaw opens and closes three times', () => {
    let opens = 0
    let wasOpen = false
    for (let s = 1.3; s < 3; s += 0.005) {
      const open = at('bite', s).jaw > 0.2
      if (open && !wasOpen) opens++
      wasOpen = open
    }
    expect(opens).toBe(3)
  })

  it('swallows from the jaw to the chest', () => {
    const [early, late] = [at('bite', 3.3).lump, at('bite', 3.85).lump]
    expect(early).toBeGreaterThan(0)
    expect(late).toBeGreaterThan(early)
    expect(at('bite', 3.1).lump).toBe(0)
  })
})

describe('the tail and the foot', () => {
  it('raises the tail before bringing it down, and lands on the beat', () => {
    const slam = ACTS.tailSlam.beats.find((beat) => beat.beat === 'slam')!.at
    expect(at('tailSlam', 0.5).tailLift).toBeGreaterThan(0.9)
    expect(at('tailSlam', slam + 0.04).tailDrop).toBeGreaterThan(0.9)
    expect(at('tailSlam', slam + 0.04).tailLift).toBeLessThan(0.1)
  })

  it('has the foot in the air before each stamp and on the ground at it', () => {
    const stamps = ACTS.stomp.beats.filter((beat) => beat.beat === 'stomp').map((beat) => beat.at)
    expect(stamps).toHaveLength(2)
    for (const stamp of stamps) {
      expect(at('stomp', stamp - 0.12).lift).toBeGreaterThan(0.5)
      expect(at('stomp', stamp + 0.04).lift).toBeLessThan(0.05)
    }
  })
})

describe('what it gets up to', () => {
  it('never does the same thing twice running, even round the end of the list', () => {
    IDLE_ORDER.forEach((name, i) => expect(name).not.toBe(IDLE_ORDER[(i + 1) % IDLE_ORDER.length]))
  })

  it('shows off everything it can do by itself', () => {
    for (const name of ['tailSlam', 'bite', 'yawn', 'stomp', 'sniff', 'pace', 'shake'] as const) expect(IDLE_ORDER).toContain(name)
  })

  it('gets less patient the more it is poked', () => {
    expect(POKE_ORDER[POKE_ORDER.length - 1]).toBe('roar')
    expect(POKE_ORDER[0]).toBe('snap')
  })

  it('is not interrupted in the middle of anything that would look broken cut short', () => {
    for (const name of ['roar', 'snap', 'bite', 'tailSlam', 'stomp', 'flinch'] as const) expect(ACTS[name].interruptible).toBe(false)
  })
})

describe('never showing its back', () => {
  const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
  /** How close a heading comes to pointing straight away from the camera. */
  const fromAway = (heading: number) => Math.abs(wrap(heading - Math.PI / 2))
  const headings = [0, 0.5, -0.5, Math.PI, Math.PI - 0.5, Math.PI + 0.5, Math.PI - 0.35, Math.PI + 0.58, Math.PI + 0.06, -Math.PI / 2]

  it.each(headings)('turns from %f to anywhere by the side facing the camera', (from) => {
    for (const to of headings) {
      const turn = turnFacingCamera(from, to)
      expect(wrap(from + turn - to)).toBeCloseTo(0, 6)
      for (let u = 0; u <= 1; u += 0.02) expect(fromAway(from + turn * u), `${from} → ${to}`).toBeGreaterThan(0.9)
    }
  })

  it('takes the short way when that is already the good way', () => {
    expect(turnFacingCamera(Math.PI + 0.58, Math.PI)).toBeCloseTo(-0.58, 6)
  })

  it('keeps taking the same way round from every point of the turn', () => {
    let yaw = 0
    const target = Math.PI - 0.35
    const sign = Math.sign(turnFacingCamera(yaw, target))
    for (let i = 0; i < 400 && Math.abs(turnFacingCamera(yaw, target)) > 0.02; i++) {
      const turn = turnFacingCamera(yaw, target)
      expect(Math.sign(turn)).toBe(sign)
      yaw += Math.sign(turn) * 0.015
    }
  })

  it.each([
    [-2, 0],
    [2, 0],
    [-0.26, -0.93],
    [0.26, -0.93],
    [0.01, -1],
    [0, -3],
    [-3, -3],
    [3, -3],
    [0, 2],
    [-1, 4],
  ])('walks towards (%f, %f) more or less side-on', (dx, dz) => {
    for (const facingLeft of [true, false]) {
      const heading = walkHeading(dx, dz, facingLeft)
      expect(Math.min(Math.abs(wrap(heading)), Math.abs(wrap(heading - Math.PI)))).toBeLessThanOrEqual(0.5 + 1e-9)
    }
  })

  it('faces where it is going when the way is clear', () => {
    expect(wrap(walkHeading(-2, 0, false) - Math.PI)).toBeCloseTo(0, 6)
    expect(wrap(walkHeading(2, 0, true))).toBeCloseTo(0, 6)
  })

  it('does not turn round for a shuffle', () => {
    expect(walkHeading(0.1, 0, true)).toBeCloseTo(Math.PI, 6)
    expect(walkHeading(-0.1, 0, false)).toBeCloseTo(0, 6)
  })
})

describe('being left alone', () => {
  it('has something smaller than a roar for a meteor that lands nearby', () => {
    expect(at('snarl', 0.3).jaw).toBeGreaterThan(0.4)
    expect(at('snarl', 0.3).jaw).toBeLessThan(0.7)
    expect(ACTS.snarl.interruptible).toBe(true)
  })
})

describe('doing as it is asked', () => {
  const busy = (over: Partial<ActInProgress>): ActInProgress => ({ name: 'bite', interruptible: false, approaching: false, left: 4, ...over })

  it('takes anything when it is free, or doing something it can be talked out of', () => {
    expect(takesRequest(null, false)).toBe(true)
    expect(takesRequest(busy({ name: 'yawn', interruptible: true }), false)).toBe(true)
  })

  it('makes its own ideas wait for whatever it is in the middle of', () => {
    expect(takesRequest(busy({}), false)).toBe(false)
    expect(takesRequest(busy({ approaching: true }), false)).toBe(false)
  })

  it('does not keep a visitor waiting through a long act', () => {
    expect(takesRequest(busy({ left: 4 }), true)).toBe(true)
    expect(takesRequest(busy({ approaching: true, left: 5.1 }), true)).toBe(true)
  })

  it('lets something nearly over finish first', () => {
    expect(takesRequest(busy({ name: 'tailSlam', left: 0.4 }), true)).toBe(false)
  })

  it('keeps nobody waiting for much more than half a second', () => {
    expect(takesRequest(busy({ name: 'tailSlam', left: 0.8 }), true)).toBe(true)
  })

  it('never cuts one roar off with another', () => {
    expect(takesRequest(busy({ name: 'roar', left: 2.5 }), true)).toBe(false)
  })
})
