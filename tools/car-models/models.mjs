// What each downloaded model is, and how its parts become the walk's roles.
import { lamp } from './lamps.mjs'
import { MODELS_A } from './models-a.mjs'
import { MODELS_B } from './models-b.mjs'

const BASE = {
  nexia: {
    file: 'daewoo_-_nexiacielo.glb',
    // Its front is +z.
    turn: 90,
    length: 4.482,
    sampleTextures: true,
    // The paint, texel by texel: a dusty blue. Dust and rust over it are not paint.
    paintTexel: (h, s, v) => {
      const hue = Math.min(1, Math.max(0, (h - 180) / 14)) * Math.min(1, Math.max(0, (262 - h) / 14))
      return hue * Math.min(1, Math.max(0, (s - 0.05) / 0.17)) * Math.min(1, Math.max(0, (v - 0.1) / 0.1))
    },
    // Measured on the normalised car; refined from the renders.
    lamps: { front: [1.95, 2.3, 0.5, 0.76, 0.2, 0.8], rear: [-2.3, -1.95, 0.62, 0.95, 0.15, 0.8] },
    // On the bumpers, a centimetre proud of them: centre x, y, z and the plate's width and height (520 × 112 mm).
    plates: { front: [2.13, 0.39, 0, 0.52, 0.112], rear: [-2.23, 0.43, 0, 0.52, 0.112] },
    credit: { title: 'Daewoo - Nexia\\Cielo', author: 'vsevolod_smoki', url: 'https://sketchfab.com/3d-models/90006f59fd594d2b95f1469f651491f1', license: 'CC BY 4.0' },
    role(ctx) {
      const { part, hsv } = ctx
      const [h, s, v] = hsv
      if (part.material === 'Glass') return 'glass'
      if (part.material === 'Wheel' || /Disk/i.test(part.node)) return 'wheel'
      const l = lamp(ctx, this.lamps)
      if (l) return l
      // Everything else of the body is one skin, tinted where its texture is paint.
      return 'skin'
    },
  },
}

export const MODELS = { ...BASE, ...MODELS_A, ...MODELS_B }
