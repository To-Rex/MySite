import {
  blob,
  buildCreature,
  createCreature,
  cut,
  mirrored,
  tube,
  type BoneSpec,
  type CreatureDetail,
  type CreatureKind,
  type CreaturePayload,
  type EyeSpec,
  type Part,
  type ToothRow,
} from './creatures'

/**
 * The six animals behind the languages Dilshodjon works around — the snake, the
 * elephant, the gopher, the crab, the swift and the camel. One of them is
 * summoned by the hero's easter egg, and the tyrannosaur eats it.
 *
 * Authored with the same primitives as the brand creatures, and deliberately at
 * the same *raw* scale (roughly four units nose to tail). The field spacing and
 * fillet radius in `creatures.ts` are absolute, so an animal drawn at half that
 * size would have half the detail budget: legs and beaks thinner than the blend
 * radius simply dissolve into the body. Keep every radius here above ~0.1.
 *
 * Like `creatures.ts` this module never touches three.js, so it rides along into
 * the meshing worker for free.
 */

export type MascotKind = 'python' | 'elephant' | 'gopher' | 'crab' | 'swift' | 'camel'

/**
 * Not a language mascot, so deliberately not in `MASCOT_KINDS`: the easter egg
 * picks from that list, and a pterosaur has nothing to do with the stack. It is
 * here because it is authored exactly like the others and rides the same worker.
 */
export type ExtraKind = 'pterosaur' | 'sauropod' | 'stegosaur'

/** Everything this module can mesh. */
export type BeastKind = MascotKind | ExtraKind

export const MASCOT_KINDS: readonly MascotKind[] = ['python', 'elephant', 'gopher', 'crab', 'swift', 'camel']

const BEAST_KINDS = new Set<string>([...MASCOT_KINDS, 'pterosaur', 'sauropod', 'stegosaur'])

export function isBeastKind(kind: string): kind is BeastKind {
  return BEAST_KINDS.has(kind)
}

interface Mascot {
  parts: Part[]
  bones: BoneSpec[]
  eye: EyeSpec
  teeth: ToothRow[]
}

/* -------------------------------------------------------------------------- */
/* Python — a rock python in a loose S, head raised off the coil               */
/* -------------------------------------------------------------------------- */

const PYTHON: Mascot = {
  parts: [
    // One continuous body: thin at the tail, thickest a third of the way along,
    // tapering again into the neck as it lifts.
    tube(
      [
        [-2.2, 0.22, 0.95],
        [-1.25, 0.24, -0.72],
        [0.0, 0.26, 0.52],
        [1.0, 0.52, -0.22],
        [1.72, 1.0, -0.02],
        [2.16, 1.26, 0],
      ],
      [0.11, 0.3, 0.42, 0.38, 0.3, 0.27],
    ),
    blob([2.45, 1.3, 0], [0.42, 0.26, 0.33]), // skull: wider than the neck
    blob([2.52, 1.19, 0], [0.34, 0.16, 0.27]), // jaw
    ...mirrored(cut([2.46, 1.4, 0.21], [0.12, 0.1, 0.1])), // eye sockets
    cut([2.74, 1.235, 0], [0.26, 0.04, 0.23]), // mouth line
    ...mirrored(cut([2.78, 1.37, 0.08], [0.055, 0.05, 0.05])), // nostrils
  ],
  bones: [
    { name: 'root', parent: null, head: [-2.2, 0.22, 0.95] },
    { name: 'body1', parent: 'root', head: [-1.25, 0.24, -0.72] },
    { name: 'body2', parent: 'body1', head: [0.0, 0.26, 0.52] },
    { name: 'body3', parent: 'body2', head: [1.0, 0.52, -0.22] },
    { name: 'neck', parent: 'body3', head: [1.72, 1.0, -0.02] },
    { name: 'head', parent: 'neck', head: [2.4, 1.28, 0], tip: [2.86, 1.25, 0] },
  ],
  eye: { bone: 'head', at: [2.46, 1.405, 0.215], radius: 0.1 },
  // Two fangs, and nothing else — a python's other teeth are too fine to read.
  teeth: [
    { fromX: 2.62, toX: 2.68, fromY: 1.2, toY: 1.2, fromZ: 0.13, toZ: 0.1, count: 1, length: 0.2, radius: 0.05, down: true },
  ],
}

/* -------------------------------------------------------------------------- */
/* Elephant                                                                    */
/* -------------------------------------------------------------------------- */

const ELEPHANT: Mascot = {
  parts: [
    blob([0, 1.35, 0], [1.3, 1.02, 0.95]), // barrel
    blob([0.62, 1.45, 0], [0.82, 0.86, 0.86]), // shoulders
    blob([1.52, 1.5, 0], [0.62, 0.62, 0.58]), // head
    blob([1.44, 1.92, 0], [0.5, 0.36, 0.5]), // domed forehead
    tube(
      [
        [1.96, 1.3, 0],
        [2.3, 0.86, 0.05],
        [2.42, 0.4, 0.08],
        [2.28, 0.04, 0.08],
      ],
      [0.3, 0.24, 0.18, 0.12],
    ), // trunk, curling under
    ...mirrored(tube(
      [
        [1.94, 1.1, 0.26],
        [2.26, 0.86, 0.3],
        [2.46, 0.79, 0.32],
      ],
      [0.11, 0.08, 0.04],
    )), // tusks
    ...mirrored(blob([1.24, 1.56, 0.64], [0.46, 0.8, 0.14], 0.4)), // ears
    ...mirrored(tube([[0.64, 0.6, 0.56], [0.64, 0.0, 0.58], [0.64, -0.58, 0.58]], [0.34, 0.3, 0.33])),
    ...mirrored(tube([[-0.74, 0.6, 0.54], [-0.74, 0.0, 0.56], [-0.74, -0.58, 0.56]], [0.34, 0.3, 0.33])),
    tube([[-1.22, 1.4, 0], [-1.5, 0.92, 0], [-1.6, 0.56, 0]], [0.11, 0.08, 0.055]), // tail
    ...mirrored(cut([1.78, 1.63, 0.4], [0.13, 0.12, 0.1])), // eye sockets
  ],
  bones: [
    { name: 'root', parent: null, head: [0, 1.35, 0] },
    { name: 'head', parent: 'root', head: [1.5, 1.5, 0], tip: [1.98, 1.32, 0] },
    { name: 'trunk1', parent: 'head', head: [2.1, 1.06, 0] },
    { name: 'trunk2', parent: 'trunk1', head: [2.38, 0.5, 0], tip: [2.28, 0.02, 0] },
    { name: 'tail', parent: 'root', head: [-1.22, 1.4, 0], tip: [-1.6, 0.56, 0] },
  ],
  eye: { bone: 'head', at: [1.782, 1.632, 0.402], radius: 0.105 },
  teeth: [],
}

/* -------------------------------------------------------------------------- */
/* Gopher — upright, all head and incisors                                     */
/* -------------------------------------------------------------------------- */

const GOPHER: Mascot = {
  parts: [
    blob([0, 1.1, 0], [0.86, 1.05, 0.78]), // body, sitting up
    blob([0.2, 2.15, 0], [0.78, 0.72, 0.72]), // head
    blob([0.7, 1.96, 0], [0.34, 0.3, 0.32]), // muzzle
    ...mirrored(blob([0.5, 1.95, 0.4], [0.3, 0.28, 0.25])), // cheek pouches
    ...mirrored(blob([0.0, 2.76, 0.42], [0.2, 0.24, 0.11])), // ears
    ...mirrored(cut([0.63, 2.23, 0.34], [0.2, 0.2, 0.18])), // the big eyes
    ...mirrored(tube([[0.38, 1.42, 0.66], [0.66, 1.06, 0.74], [0.74, 0.78, 0.74]], [0.2, 0.16, 0.14])), // arms
    ...mirrored(blob([0.46, 0.15, 0.38], [0.36, 0.17, 0.23])), // feet
    tube([[-0.76, 0.96, 0], [-1.0, 0.82, 0]], [0.14, 0.09]), // tail
    cut([0.94, 1.83, 0], [0.12, 0.05, 0.2]), // the line the incisors sit under
  ],
  bones: [
    { name: 'root', parent: null, head: [0, 1.1, 0] },
    { name: 'head', parent: 'root', head: [0.2, 2.15, 0], tip: [0.96, 1.92, 0] },
    { name: 'tail', parent: 'root', head: [-0.76, 0.96, 0], tip: [-1.04, 0.8, 0] },
  ],
  eye: { bone: 'head', at: [0.636, 2.236, 0.346], radius: 0.165 },
  teeth: [
    { fromX: 0.93, toX: 0.96, fromY: 1.83, toY: 1.83, fromZ: 0.11, toZ: 0.11, count: 1, length: 0.26, radius: 0.085, down: true },
  ],
}

/* -------------------------------------------------------------------------- */
/* Crab — wider than it is long, claws forward, eyes on stalks                 */
/* -------------------------------------------------------------------------- */

const CRAB: Mascot = {
  parts: [
    blob([0, 0.56, 0], [1.05, 0.34, 0.86]), // carapace
    blob([0, 0.74, 0], [0.85, 0.34, 0.66]), // dome
    blob([0.6, 0.5, 0], [0.5, 0.24, 0.6]), // front rim
    ...mirrored(tube([[0.5, 0.86, 0.24], [0.62, 1.2, 0.3]], [0.11, 0.1])), // eye stalks
    ...mirrored(tube([[0.76, 0.56, 0.62], [1.26, 0.5, 0.96]], [0.17, 0.15])), // claw arms
    ...mirrored(blob([1.6, 0.5, 1.2], [0.42, 0.27, 0.3], -0.35)), // claws
    ...mirrored(cut([1.88, 0.57, 1.4], [0.24, 0.075, 0.26], -0.35)), // the pincer gap
    ...mirrored(tube([[0.3, 0.5, 0.8], [0.74, 0.3, 1.22], [0.88, 0.0, 1.46]], [0.11, 0.09, 0.07])),
    ...mirrored(tube([[-0.06, 0.5, 0.82], [0.3, 0.28, 1.3], [0.38, -0.02, 1.56]], [0.11, 0.09, 0.07])),
    ...mirrored(tube([[-0.42, 0.5, 0.76], [-0.16, 0.26, 1.2], [-0.1, -0.02, 1.46]], [0.11, 0.09, 0.07])),
  ],
  bones: [
    { name: 'root', parent: null, head: [0, 0.56, 0], tip: [0.7, 0.52, 0] },
    { name: 'clawL', parent: 'root', head: [0.8, 0.56, 0.66], tip: [1.74, 0.5, 1.26] },
    { name: 'clawR', parent: 'root', head: [0.8, 0.56, -0.66], tip: [1.74, 0.5, -1.26] },
  ],
  // Hung off the body rather than a head bone: the stalks are part of the shell.
  eye: { bone: 'root', at: [0.64, 1.28, 0.302], radius: 0.115 },
  teeth: [],
}

/* -------------------------------------------------------------------------- */
/* Swift — a bird built for speed: swept wings, forked tail                    */
/* -------------------------------------------------------------------------- */

const SWIFT: Mascot = {
  parts: [
    blob([0, 1.0, 0], [0.78, 0.42, 0.4]), // body
    blob([0.38, 0.96, 0], [0.46, 0.37, 0.37]), // breast
    blob([0.86, 1.18, 0], [0.36, 0.34, 0.33]), // head
    tube([[1.12, 1.14, 0], [1.4, 1.08, 0], [1.58, 1.05, 0]], [0.14, 0.09, 0.04]), // beak
    ...mirrored(blob([-0.1, 1.05, 0.92], [0.98, 0.11, 0.86], 0.5)), // wings, swept back
    ...mirrored(blob([-0.98, 1.05, 1.76], [0.58, 0.08, 0.4], 0.85)), // primaries
    ...mirrored(blob([-1.0, 0.99, 0.17], [0.56, 0.09, 0.17], -0.16)), // forked tail
    ...mirrored(cut([1.03, 1.25, 0.245], [0.1, 0.1, 0.09])), // eye sockets
    cut([1.36, 1.1, 0], [0.16, 0.025, 0.1]), // bill line
  ],
  bones: [
    { name: 'root', parent: null, head: [0, 1.0, 0] },
    { name: 'head', parent: 'root', head: [0.86, 1.18, 0], tip: [1.5, 1.06, 0] },
    { name: 'wingL', parent: 'root', head: [0.02, 1.05, 0.42], tip: [-0.92, 1.05, 1.92] },
    { name: 'wingR', parent: 'root', head: [0.02, 1.05, -0.42], tip: [-0.92, 1.05, -1.92] },
    { name: 'tail', parent: 'root', head: [-0.72, 0.99, 0], tip: [-1.5, 0.97, 0] },
  ],
  eye: { bone: 'head', at: [1.034, 1.252, 0.248], radius: 0.085 },
  teeth: [],
}

/* -------------------------------------------------------------------------- */
/* Camel — one hump, long neck, long legs                                      */
/* -------------------------------------------------------------------------- */

const CAMEL: Mascot = {
  parts: [
    blob([0, 1.7, 0], [1.16, 0.7, 0.66]), // barrel
    blob([-0.1, 2.34, 0], [0.62, 0.56, 0.52]), // hump
    blob([0.78, 1.62, 0], [0.5, 0.56, 0.5]), // chest
    tube([[0.92, 1.92, 0], [1.26, 2.5, 0], [1.46, 3.04, 0]], [0.34, 0.28, 0.24]), // neck
    blob([1.6, 3.2, 0], [0.34, 0.3, 0.29]), // head
    tube([[1.74, 3.12, 0], [2.02, 3.0, 0]], [0.23, 0.15]), // muzzle
    ...mirrored(blob([1.44, 3.46, 0.17], [0.11, 0.16, 0.07])), // ears
    ...mirrored(cut([1.76, 3.31, 0.215], [0.095, 0.095, 0.085])), // eye sockets
    cut([2.04, 2.97, 0], [0.14, 0.03, 0.15]), // mouth line
    ...mirrored(tube([[0.72, 1.24, 0.4], [0.8, 0.62, 0.42], [0.74, 0.06, 0.42]], [0.23, 0.17, 0.155])),
    ...mirrored(tube([[-0.76, 1.28, 0.4], [-0.68, 0.62, 0.42], [-0.74, 0.06, 0.42]], [0.25, 0.18, 0.155])),
    tube([[-1.16, 1.86, 0], [-1.36, 1.42, 0], [-1.42, 1.16, 0]], [0.11, 0.075, 0.05]), // tail
  ],
  bones: [
    { name: 'root', parent: null, head: [0, 1.7, 0] },
    { name: 'neck', parent: 'root', head: [1.0, 2.1, 0] },
    { name: 'head', parent: 'neck', head: [1.58, 3.18, 0], tip: [2.08, 3.0, 0] },
    { name: 'tail', parent: 'root', head: [-1.16, 1.86, 0], tip: [-1.42, 1.16, 0] },
  ],
  eye: { bone: 'head', at: [1.764, 3.312, 0.218], radius: 0.08 },
  teeth: [],
}

/* -------------------------------------------------------------------------- */
/* Pterosaur — the Jurassic flyer: all wing, long beak, vaned tail             */
/* -------------------------------------------------------------------------- */

const PTEROSAUR: Mascot = {
  parts: [
    blob([0, 1.0, 0], [0.5, 0.28, 0.28]), // body
    blob([0.36, 1.0, 0], [0.34, 0.27, 0.27]), // chest, where the wings anchor
    tube([[0.62, 1.05, 0], [0.86, 1.12, 0]], [0.18, 0.15]), // neck
    blob([1.05, 1.15, 0], [0.3, 0.2, 0.18]), // skull
    blob([1.0, 1.32, 0], [0.17, 0.13, 0.055]), // crest
    tube([[1.24, 1.13, 0], [1.66, 1.09, 0], [1.98, 1.06, 0]], [0.15, 0.095, 0.035]), // beak
    ...mirrored(cut([1.13, 1.22, 0.14], [0.085, 0.08, 0.07])), // eye sockets
    cut([1.6, 1.095, 0], [0.3, 0.022, 0.07]), // the line of the jaw

    // --- Wings: a spar along the leading edge with the membrane behind it -----
    ...mirrored(tube(
      [
        [0.42, 1.05, 0.28],
        [0.24, 1.04, 1.2],
        [-0.3, 1.02, 2.0],
        [-0.95, 1.0, 2.62],
      ],
      [0.14, 0.11, 0.085, 0.055],
    )),
    ...mirrored(blob([0.1, 1.02, 0.8], [0.52, 0.055, 0.78], 0.3)),
    ...mirrored(blob([-0.42, 1.0, 1.75], [0.46, 0.05, 0.6], 0.62)),
    ...mirrored(blob([-0.92, 0.99, 2.42], [0.3, 0.042, 0.34], 0.85)),

    // --- Tail: long and thin, with the diamond vane a Rhamphorhynchus carries --
    tube([[-0.46, 1.0, 0], [-1.3, 0.98, 0], [-2.0, 0.96, 0]], [0.12, 0.07, 0.05]),
    blob([-2.22, 0.96, 0], [0.24, 0.19, 0.045]),

    // --- Legs, tucked up under the membrane -----------------------------------
    ...mirrored(tube([[-0.22, 0.9, 0.22], [-0.52, 0.72, 0.34], [-0.74, 0.62, 0.4]], [0.1, 0.08, 0.06])),
  ],
  bones: [
    { name: 'root', parent: null, head: [0, 1.0, 0] },
    { name: 'neck', parent: 'root', head: [0.7, 1.08, 0] },
    { name: 'head', parent: 'neck', head: [1.05, 1.15, 0], tip: [1.9, 1.07, 0] },
    { name: 'wingL', parent: 'root', head: [0.36, 1.04, 0.3] },
    { name: 'wingLTip', parent: 'wingL', head: [-0.3, 1.02, 1.62], tip: [-1.0, 1.0, 2.7] },
    { name: 'wingR', parent: 'root', head: [0.36, 1.04, -0.3] },
    { name: 'wingRTip', parent: 'wingR', head: [-0.3, 1.02, -1.62], tip: [-1.0, 1.0, -2.7] },
    { name: 'tail', parent: 'root', head: [-0.46, 1.0, 0], tip: [-2.3, 0.96, 0] },
  ],
  eye: { bone: 'head', at: [1.134, 1.224, 0.142], radius: 0.072 },
  teeth: [
    { fromX: 1.34, toX: 1.72, fromY: 1.09, toY: 1.085, fromZ: 0.055, toZ: 0.03, count: 4, length: 0.08, radius: 0.017, down: true },
  ],
}

/* -------------------------------------------------------------------------- */
/* Sauropod — the long one: neck up, tail out, standing on four pillars        */
/* -------------------------------------------------------------------------- */

const SAUROPOD: Mascot = {
  parts: [
    blob([0, 1.55, 0], [1.45, 0.88, 0.86]), // barrel
    blob([1.05, 1.6, 0], [0.9, 0.78, 0.78]), // shoulders
    blob([-1.15, 1.52, 0], [0.92, 0.8, 0.8]), // hips
    tube(
      [
        [1.75, 1.85, 0],
        [2.6, 2.5, 0],
        [3.5, 3.2, 0],
        [4.25, 3.62, 0],
      ],
      [0.46, 0.36, 0.28, 0.21],
    ), // neck
    blob([4.5, 3.72, 0], [0.3, 0.23, 0.22]), // small head
    tube([[4.66, 3.68, 0], [4.96, 3.6, 0]], [0.2, 0.13]), // muzzle
    ...mirrored(cut([4.54, 3.83, 0.16], [0.085, 0.08, 0.07])), // eye sockets
    tube(
      [
        [-1.85, 1.5, 0],
        [-3.1, 1.42, 0],
        [-4.4, 1.3, 0],
        [-5.6, 1.16, 0],
      ],
      [0.5, 0.33, 0.19, 0.08],
    ), // tail
    ...mirrored(tube([[1.0, 1.15, 0.58], [1.06, 0.6, 0.6], [1.0, 0.06, 0.6]], [0.34, 0.3, 0.33])),
    ...mirrored(tube([[-1.15, 1.12, 0.6], [-1.1, 0.58, 0.62], [-1.16, 0.06, 0.62]], [0.36, 0.32, 0.35])),
  ],
  bones: [
    { name: 'root', parent: null, head: [0, 1.55, 0] },
    { name: 'neck1', parent: 'root', head: [1.75, 1.85, 0] },
    { name: 'neck2', parent: 'neck1', head: [2.7, 2.6, 0] },
    { name: 'neck3', parent: 'neck2', head: [3.6, 3.3, 0] },
    { name: 'head', parent: 'neck3', head: [4.45, 3.7, 0], tip: [5.0, 3.6, 0] },
    { name: 'tail1', parent: 'root', head: [-1.85, 1.5, 0] },
    { name: 'tail2', parent: 'tail1', head: [-3.1, 1.42, 0] },
    { name: 'tail3', parent: 'tail2', head: [-4.4, 1.3, 0] },
    { name: 'tail4', parent: 'tail3', head: [-5.6, 1.16, 0], tip: [-6.1, 1.1, 0] },
  ],
  eye: { bone: 'head', at: [4.544, 3.834, 0.162], radius: 0.07 },
  teeth: [],
}

/* -------------------------------------------------------------------------- */
/* Stegosaur — low head, arched back, a double row of plates, spiked tail      */
/* -------------------------------------------------------------------------- */

const PLATES: Part[] = []
for (let i = 0; i < 7; i++) {
  const along = 1.05 - i * 0.42
  const bell = Math.sin(((i + 0.6) / 7.4) * Math.PI)
  PLATES.push(
    blob([along, 1.62 + bell * 0.42, i % 2 === 0 ? 0.1 : -0.1], [0.14 + bell * 0.13, 0.16 + bell * 0.38, 0.055]),
  )
}

const STEGOSAUR: Mascot = {
  parts: [
    blob([0, 1.05, 0], [1.25, 0.72, 0.68]), // barrel
    blob([-0.1, 1.42, 0], [0.95, 0.5, 0.55]), // the arch of the back
    blob([1.15, 0.95, 0], [0.55, 0.5, 0.52]), // chest
    tube([[1.45, 1.0, 0], [1.9, 0.86, 0]], [0.32, 0.2]), // short neck, carried low
    blob([2.1, 0.82, 0], [0.3, 0.2, 0.2]), // head
    tube([[2.28, 0.8, 0], [2.56, 0.78, 0]], [0.16, 0.1]), // beak
    ...mirrored(cut([2.14, 0.9, 0.15], [0.075, 0.07, 0.065])), // eye sockets
    ...PLATES,
    tube([[-1.3, 1.1, 0], [-2.3, 1.05, 0], [-3.05, 1.12, 0]], [0.4, 0.24, 0.13]), // tail
    // Thagomizer: two pairs of spikes off the tail tip.
    ...mirrored(tube([[-2.85, 1.12, 0.1], [-3.35, 1.42, 0.24]], [0.09, 0.03])),
    ...mirrored(tube([[-3.05, 1.1, 0.09], [-3.6, 1.3, 0.2]], [0.085, 0.03])),
    ...mirrored(tube([[0.95, 0.75, 0.5], [1.0, 0.4, 0.52], [0.95, 0.05, 0.52]], [0.24, 0.21, 0.23])),
    ...mirrored(tube([[-1.0, 0.8, 0.54], [-0.96, 0.42, 0.56], [-1.02, 0.05, 0.56]], [0.3, 0.26, 0.28])),
  ],
  bones: [
    { name: 'root', parent: null, head: [0, 1.15, 0] },
    { name: 'neck', parent: 'root', head: [1.45, 1.0, 0] },
    { name: 'head', parent: 'neck', head: [2.08, 0.84, 0], tip: [2.6, 0.78, 0] },
    { name: 'tail1', parent: 'root', head: [-1.3, 1.1, 0] },
    { name: 'tail2', parent: 'tail1', head: [-2.3, 1.05, 0] },
    { name: 'tail3', parent: 'tail2', head: [-3.05, 1.12, 0], tip: [-3.6, 1.3, 0] },
  ],
  eye: { bone: 'head', at: [2.144, 0.904, 0.152], radius: 0.062 },
  teeth: [],
}

const BEASTS: Record<BeastKind, Mascot> = {
  python: PYTHON,
  elephant: ELEPHANT,
  gopher: GOPHER,
  crab: CRAB,
  swift: SWIFT,
  camel: CAMEL,
  pterosaur: PTEROSAUR,
  sauropod: SAUROPOD,
  stegosaur: STEGOSAUR,
}

/** Every creature the site can mesh: the two brand animals plus the six mascots. */
export type AnyCreatureKind = CreatureKind | BeastKind

/**
 * The single place that knows about both sets, so the worker and the main-thread
 * fallback cannot drift apart. `creatures.ts` deliberately does not import this
 * module — the dependency runs one way only.
 */
export function createAnyCreature(kind: AnyCreatureKind, detail: CreatureDetail): CreaturePayload {
  if (!isBeastKind(kind)) return createCreature(kind, detail)
  const m = BEASTS[kind]
  return buildCreature(m.parts, m.bones, m.eye, m.teeth, detail)
}
