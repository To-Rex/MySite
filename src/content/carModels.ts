/**
 * The cars of the long walk's street that are drawn from models other people
 * made, and whose they are. Each is under a Creative Commons Attribution
 * licence, which asks for exactly this: the author, a link to the work, and the
 * licence, where the work is used. The site's footer lists them from here, and
 * the walk loads the files from here — a car that is not listed is the walk's
 * own procedural one.
 *
 * The files in `public/models/cars/` are these models prepared for the walk
 * (README → The traffic): the badges and the plates taken off, most insides taken
 * out, the wheels separated, simplified and compressed. That is a change to the work,
 * which the licence allows and asks to be said; the footer says it. Each file
 * carries its own credit too, which a test holds to the one here.
 *
 * Plain data: no three.js, so the footer can read it.
 */
export interface CarModel {
  /** Which of the walk's vehicles it is drawn for: a `VehicleKind`. */
  kind: 'nexia' | 'damas' | 'matiz' | 'malibu' | 'zhiguli'
  /** Which of the kind's two faces, where it has two (the Zhiguli: 0 the 2106's, 1 the 2107's). */
  variant?: 0 | 1
  /** Where the prepared file is served from: a binary glTF, gzipped. */
  file: string
  /** The work's title and its author, as they give them, and where it is. */
  title: string
  author: string
  url: string
  licence: 'CC BY 4.0'
}

export const CC_BY = 'https://creativecommons.org/licenses/by/4.0/'

/**
 * What a prepared file's materials may be, each by the role in its extras (or
 * the prefix of its name): what the walk draws each of them as. `skin` is a
 * body in its own picture, with a mask of where the paint is; `paint` is paint
 * with no picture; the lamps keep their pictures and are lit by the walk; a
 * `cabin` is the dark box where an inside was.
 */
export const MODEL_ROLES = ['skin', 'paint', 'glass', 'chrome', 'trim', 'lamp_front', 'lamp_rear', 'lamp_turn', 'tyre', 'rim', 'wheel', 'cabin', 'detail'] as const
export type ModelRole = (typeof MODEL_ROLES)[number]

/** What a material is, by the role it is given, or its name; what is not given one is an odd end. */
export function roleOf(name: string, given?: unknown): ModelRole {
  if (typeof given === 'string' && (MODEL_ROLES as readonly string[]).includes(given)) return given as ModelRole
  return MODEL_ROLES.find((role) => name.startsWith(role)) ?? 'detail'
}

export const CAR_MODELS: readonly CarModel[] = [
  {
    kind: 'nexia',
    file: '/models/cars/nexia.glb.gz',
    title: 'Daewoo - Nexia\\Cielo',
    author: 'vsevolod_smoki',
    url: 'https://sketchfab.com/3d-models/90006f59fd594d2b95f1469f651491f1',
    licence: 'CC BY 4.0',
  },
  {
    kind: 'damas',
    file: '/models/cars/damas.glb.gz',
    title: 'Chevrolet Damas',
    author: 'own.guest',
    url: 'https://sketchfab.com/3d-models/70f8556e4b3840e7b975f0e000b54757',
    licence: 'CC BY 4.0',
  },
  {
    kind: 'matiz',
    file: '/models/cars/matiz.glb.gz',
    title: 'Daewoo Matiz',
    author: 'elijahforonda631',
    url: 'https://sketchfab.com/3d-models/61be0476f0d64a9d8b37e4cdbc430fff',
    licence: 'CC BY 4.0',
  },
  {
    kind: 'malibu',
    file: '/models/cars/malibu.glb.gz',
    title: '2021 Chevrolet Malibu 2LZ Premier',
    author: 'twr422',
    url: 'https://sketchfab.com/3d-models/c1e8e127ce114b14a166e93100642424',
    licence: 'CC BY 4.0',
  },
  {
    kind: 'zhiguli',
    variant: 0,
    file: '/models/cars/vaz2106.glb.gz',
    title: 'VAZ-2106',
    author: 'domhathair',
    url: 'https://sketchfab.com/3d-models/a73b3cdeddd846209bf7c73d5f04d20f',
    licence: 'CC BY 4.0',
  },
  {
    kind: 'zhiguli',
    variant: 1,
    file: '/models/cars/vaz2107.glb.gz',
    title: 'Old car - VAZ 2107',
    author: 'prephonat',
    url: 'https://sketchfab.com/3d-models/91270dab9d1a47c7ba7ffaaf8c8b0beb',
    licence: 'CC BY 4.0',
  },
]
