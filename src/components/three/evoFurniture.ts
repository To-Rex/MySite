import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'
import { PARS_HERE, inAir, ownShadow, type Air, type Shader } from './evoAir'
import { BENCHES, BINS, CITY_LIGHT_GLSL, FENCE, METRO, ROAD, SHELTER, STREET_GLSL, STREET_Z } from './evoStreet'
import type { Beat, Part } from './evoWalk'

/**
 * What stands about on the street that is not a building, a tree or a lamp:
 * the bus shelter at the stop, the metro's pylon on the corner of the
 * square, benches on the square, litter bins, and the low fence down the
 * middle of the road. Where each of them is, is in `evoStreet.ts`.
 *
 * They are lit as the lamp posts are, by three's lights — and by the
 * street's lamps as well, worked out from where those stand, the way the
 * ground is, so that at night the shelter's frame and the benches are not
 * the only dark things on a lit street.
 */

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback)

type RGB = readonly [number, number, number]
type V3 = readonly [number, number, number]

/** A pile of boxes and other shapes in one geometry, coloured by vertex. */
class Pile {
  private readonly positions: number[] = []
  private readonly normals: number[] = []
  private readonly colors: number[] = []

  private quad(a: V3, b: V3, c: V3, d: V3, color: RGB): void {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]
    const length = Math.hypot(n[0]!, n[1]!, n[2]!) || 1
    for (const p of [a, b, c, a, c, d]) {
      this.positions.push(p[0], p[1], p[2])
      this.normals.push(n[0]! / length, n[1]! / length, n[2]! / length)
      this.colors.push(color[0], color[1], color[2])
    }
  }

  /** An axis-aligned box from one corner to the other, every face outwards. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: RGB): this {
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color)
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color)
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], color)
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color)
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color)
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color)
    return this
  }

  /** Another geometry, moved by `at` and coloured. */
  shape(geometry: BufferGeometry, at: V3, color: RGB): this {
    const source = geometry.index ? geometry.toNonIndexed() : geometry
    const p = source.getAttribute('position')
    const n = source.getAttribute('normal')
    for (let i = 0; i < p.count; i++) {
      this.positions.push(p.getX(i) + at[0], p.getY(i) + at[1], p.getZ(i) + at[2])
      this.normals.push(n.getX(i), n.getY(i), n.getZ(i))
      this.colors.push(color[0], color[1], color[2])
    }
    if (source !== geometry) source.dispose()
    geometry.dispose()
    return this
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3))
    g.computeBoundingSphere()
    return g
  }
}

/** A colour as three linear numbers, from sRGB. */
const lin = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.pow(v / 255, 2.2)
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)]
}

const STEEL = lin('#3a4646')
const PALE_STEEL = lin('#c9ccc8')
const ROOF = lin('#dcdcd6')
const WOOD = lin('#8a5a32')
const IRON = lin('#26282a')
const BIN_GREEN = lin('#2f5038')
const PYLON = lin('#1f2c45')

/** The street's lamps on a standard material: added as light that is already there, from where the lamps stand. */
function underTheLamps(shader: Shader, lamps: { value: number }): void {
  shader.uniforms.uLamps = lamps
  shader.fragmentShader = shader.fragmentShader
    .replace(PARS_HERE, `${PARS_HERE}\nuniform float uLamps;\n${STREET_GLSL}\n${CITY_LIGHT_GLSL}`)
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      if (uLamps > 0.001) {
        vec3 evoN = inverseTransformDirection(normal, viewMatrix);
        totalEmissiveRadiance += diffuseColor.rgb * (evoStreetLight(vEvoWorld, evoN, 0.3) + evoLanternLight(vEvoWorld, evoN, 0.3)) * 0.42 * uLamps;
      }`,
    )
}

/** Words on a board, drawn once: the stop's name and the numbers of the routes that call there. */
function drawStopBoard(canvas: HTMLCanvasElement): void {
  canvas.width = 1024
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#123f7a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.font = '800 38px Manrope, "Manrope Variable", system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('AVTOBUS BEKATI', 26, 34)
  // The routes, each on a chip of its own.
  const routes = ['8', '27', '51', '67', '93', '115']
  ctx.font = '800 30px Manrope, "Manrope Variable", system-ui, sans-serif'
  let x = canvas.width - 22
  for (const route of [...routes].reverse()) {
    const w = Math.max(54, ctx.measureText(route).width + 22)
    x -= w
    ctx.fillStyle = '#f2c230'
    ctx.beginPath()
    ctx.roundRect(x, 12, w - 8, 40, 8)
    ctx.fill()
    ctx.fillStyle = '#10223f'
    ctx.textAlign = 'center'
    ctx.fillText(route, x + (w - 8) / 2, 34)
    x -= 6
  }
}

/** The metro's M: blue on white, as the city's stations have it. */
function drawMetro(canvas: HTMLCanvasElement): void {
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#f4f6f8'
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = '#1d4fa3'
  ctx.lineWidth = 10
  ctx.strokeRect(9, 9, 238, 238)
  ctx.fillStyle = '#1d4fa3'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '800 200px Manrope, "Manrope Variable", system-ui, sans-serif'
  ctx.fillText('M', 128, 138)
}

function texture(draw: (canvas: HTMLCanvasElement) => void): CanvasTexture {
  const canvas = document.createElement('canvas')
  draw(canvas)
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.generateMipmaps = false
  t.minFilter = LinearFilter
  t.magFilter = LinearFilter
  return t
}

export interface FurnitureOptions {
  shadows: boolean
}

export function createFurniture(air: Air, options: FurnitureOptions): Part {
  const root = new Group()
  const disposers: (() => void)[] = []
  const lamps = { value: 0 }
  const keep = <T extends { dispose(): void }>(thing: T): T => {
    disposers.push(() => thing.dispose())
    return thing
  }
  const solid = keep(
    inAir(new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 }), air, 'furniture', (shader) => underTheLamps(shader, lamps)),
  )
  const casters: (Mesh | InstancedMesh)[] = []
  const place = (mesh: Mesh | InstancedMesh): void => {
    mesh.castShadow = options.shadows
    mesh.receiveShadow = options.shadows
    if (options.shadows) {
      disposers.push(ownShadow(mesh))
      casters.push(mesh)
    }
    mesh.frustumCulled = false
    root.add(mesh)
  }

  // ---- the bus shelter ---------------------------------------------------------
  const kerb = STREET_Z - ROAD
  const front = kerb - SHELTER.front
  const back = kerb - SHELTER.back
  const x0 = SHELTER.x - SHELTER.half
  const x1 = SHELTER.x + SHELTER.half
  const top = SHELTER.height
  const shelter = new Pile()
  for (const x of [x0 + 0.05, x1 - 0.12]) {
    shelter.box(x, 0, back + 0.02, x + 0.07, top - 0.12, back + 0.09, STEEL)
    shelter.box(x, 0, front - 0.09, x + 0.07, top - 0.12, front - 0.02, STEEL)
  }
  // The roof, out over the kerb, and its edge.
  shelter.box(x0 - 0.15, top - 0.14, back - 0.06, x1 + 0.15, top, front + 0.3, ROOF)
  shelter.box(x0 - 0.15, top - 0.3, front + 0.24, x1 + 0.15, top, front + 0.3, STEEL)
  // The bench along the back, on two legs, and the lit panel at the end.
  shelter.box(x0 + 0.45, 0.42, back + 0.12, x1 - 1.75, 0.47, back + 0.5, WOOD)
  for (const x of [x0 + 0.7, x1 - 2.1]) shelter.box(x, 0, back + 0.2, x + 0.06, 0.42, back + 0.42, STEEL)
  shelter.box(x1 - 1.55, 0.05, back + 0.1, x1 - 0.25, 2.05, back + 0.24, STEEL)
  place(new Mesh(keep(shelter.geometry()), solid))
  // Glass at the back and the two ends, a little blue.
  const glassMaterial = keep(
    inAir(new MeshStandardMaterial({ color: '#b9d4dc', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }), air, 'glass'),
  )
  const panes = new Pile()
  panes.box(x0 + 0.12, 0.14, back + 0.045, x1 - 0.12, top - 0.2, back + 0.06, PALE_STEEL)
  for (const x of [x0 + 0.08, x1 - 0.09]) panes.box(x, 0.14, back + 0.09, x + 0.012, top - 0.2, back + 0.95, PALE_STEEL)
  const glass = new Mesh(keep(panes.geometry()), glassMaterial)
  glass.frustumCulled = false
  glass.renderOrder = 1
  root.add(glass)
  // The board along the edge of the roof, and the light under it.
  const boardTexture = keep(texture(drawStopBoard))
  const boardMaterial = keep(inAir(new MeshBasicMaterial({ map: boardTexture }), air, 'board'))
  const boardGeometry = keep(new PlaneGeometry(x1 - x0 + 0.3, ((x1 - x0 + 0.3) * 64) / 1024))
  const board = new Mesh(boardGeometry, boardMaterial)
  board.position.set(SHELTER.x, top - 0.15, front + 0.305)
  board.frustumCulled = false
  root.add(board)
  const panelTexture = keep(texture(drawRoutes))
  const panelMaterial = keep(inAir(new MeshBasicMaterial({ map: panelTexture }), air, 'board'))
  const panelGeometry = keep(new PlaneGeometry(1.18, 1.86))
  const panel = new Mesh(panelGeometry, panelMaterial)
  panel.position.set(x1 - 0.9, 1.06, back + 0.245)
  panel.frustumCulled = false
  root.add(panel)
  const stripMaterial = keep(new MeshBasicMaterial({ color: '#ffffff' }))
  const strip = new Mesh(keep(new Pile().box(x0 + 0.2, top - 0.16, back + 0.5, x1 - 0.2, top - 0.14, back + 0.62, [1, 1, 1]).geometry()), stripMaterial)
  strip.frustumCulled = false
  root.add(strip)

  // ---- the metro -----------------------------------------------------------------
  const pylon = new Pile()
  pylon.box(METRO.x - 0.3, 0, METRO.z - 0.3, METRO.x + 0.3, 0.12, METRO.z + 0.3, PYLON)
  pylon.box(METRO.x - 0.2, 0.12, METRO.z - 0.2, METRO.x + 0.2, METRO.height - METRO.width - 0.05, METRO.z + 0.2, PYLON)
  place(new Mesh(keep(pylon.geometry()), solid))
  const metroTexture = keep(texture(drawMetro))
  const metroMaterial = keep(inAir(new MeshBasicMaterial({ map: metroTexture }), air, 'board'))
  const capMaterial = keep(inAir(new MeshBasicMaterial({ color: '#1d4fa3' }), air, 'board'))
  // A box takes a material for each of its faces, in the order +x, -x, +y, -y, +z, -z.
  const sign = new Mesh(keep(new BoxGeometry(METRO.width, METRO.width, METRO.width)), [metroMaterial, metroMaterial, capMaterial, capMaterial, metroMaterial, metroMaterial])
  sign.position.set(METRO.x, METRO.height - METRO.width / 2, METRO.z)
  sign.frustumCulled = false
  root.add(sign)

  // ---- benches on the square ---------------------------------------------------------
  const bench = new Pile()
  for (const [z, y] of [
    [-0.18, 0.44],
    [-0.04, 0.45],
    [0.1, 0.46],
  ] as const)
    bench.box(-0.9, y - 0.03, z - 0.055, 0.9, y, z + 0.055, WOOD)
  for (const y of [0.62, 0.78]) bench.box(-0.9, y - 0.05, 0.2, 0.9, y + 0.05, 0.24, WOOD)
  for (const x of [-0.78, 0.72]) {
    bench.box(x, 0, -0.26, x + 0.06, 0.44, -0.2, IRON)
    bench.box(x, 0, 0.18, x + 0.06, 0.86, 0.26, IRON)
    bench.box(x, 0.38, -0.26, x + 0.06, 0.42, 0.22, IRON)
  }
  const benches = new InstancedMesh(keep(bench.geometry()), solid, BENCHES.length)
  const dummy = new Object3D()
  BENCHES.forEach((b, i) => {
    dummy.position.set(finite(b.x), 0.065, finite(b.z))
    dummy.rotation.set(0, finite(b.turn), 0)
    dummy.updateMatrix()
    benches.setMatrixAt(i, dummy.matrix)
  })
  place(benches)

  // ---- litter bins -----------------------------------------------------------------------
  const bin = new Pile()
    .shape(new CylinderGeometry(0.2, 0.17, 0.7, 12, 1, true), [0, 0.39, 0], BIN_GREEN)
    .shape(new CylinderGeometry(0.215, 0.215, 0.06, 12), [0, 0.77, 0], IRON)
    .shape(new CylinderGeometry(0.12, 0.12, 0.04, 10), [0, 0.02, 0], IRON)
  const bins = new InstancedMesh(keep(bin.geometry()), solid, BINS.length)
  dummy.rotation.set(0, 0, 0)
  BINS.forEach(([x, z], i) => {
    dummy.position.set(finite(x), 0.06, finite(z))
    dummy.updateMatrix()
    bins.setMatrixAt(i, dummy.matrix)
  })
  place(bins)

  // ---- the fence down the middle of the road ----------------------------------------------
  const spans: [number, number][] = [
    [FENCE.from, FENCE.gap[0]],
    [FENCE.gap[1], FENCE.until],
  ]
  const postAt: number[] = []
  for (const [a, b] of spans) {
    const count = Math.max(1, Math.round((b - a) / FENCE.post))
    for (let i = 0; i <= count; i++) postAt.push(a + ((b - a) * i) / count)
  }
  const post = new Pile().box(-0.022, 0, -0.022, 0.022, FENCE.height + 0.02, 0.022, PALE_STEEL)
  const posts = new InstancedMesh(keep(post.geometry()), solid, postAt.length)
  postAt.forEach((x, i) => {
    dummy.position.set(x, 0.06, STREET_Z)
    dummy.updateMatrix()
    posts.setMatrixAt(i, dummy.matrix)
  })
  place(posts)
  // Two rails, and between them a panel of thin bars: what the city's avenues have down their middles.
  const rail = new Pile()
    .box(0, FENCE.height - 0.045, -0.016, 1, FENCE.height - 0.005, 0.016, PALE_STEEL)
    .box(0, 0.3, -0.014, 1, 0.33, 0.014, PALE_STEEL)
  // Where there are no shadows there is not much to draw with either: two rails, and no bars.
  const bars = options.shadows ? 8 : 1
  for (let i = 1; i < bars; i++) rail.box(i / bars - 0.005, 0.33, -0.006, i / bars + 0.005, FENCE.height - 0.045, 0.006, PALE_STEEL)
  const railCount = postAt.length - spans.length
  const rails = new InstancedMesh(keep(rail.geometry()), solid, Math.max(1, railCount))
  let r = 0
  for (let i = 1; i < postAt.length; i++) {
    const a = postAt[i - 1]!
    const b = postAt[i]!
    if (b - a > FENCE.post * 2) continue
    dummy.position.set(a, 0.06, STREET_Z)
    dummy.scale.set(b - a, 1, 1)
    dummy.updateMatrix()
    rails.setMatrixAt(r++, dummy.matrix)
  }
  rails.count = r
  dummy.scale.set(1, 1, 1)
  place(rails)

  function update(beat: Beat): void {
    // Put in when the street is finished.
    const seen = beat.stage.city > 0.86
    root.visible = seen
    if (!seen) return
    const night = finite(beat.lamps)
    lamps.value = night
    // A shadow only while the sun is up: by night the street is lit by its lamps, and the map is drawn every frame.
    const strong = beat.sky.elevation > 0 && beat.light.r + beat.light.g + beat.light.b > 0.3
    for (const mesh of casters) mesh.castShadow = strong
    // Lit from inside once it is dark; read by day as print on a board.
    const day = 0.55 + 0.35 * Math.min(1, beat.light.r + beat.light.g + beat.light.b)
    boardMaterial.color.setScalar(day + 1.4 * night)
    panelMaterial.color.setScalar(day + 1.8 * night)
    metroMaterial.color.setScalar(day + 2.2 * night)
    capMaterial.color.set('#1d4fa3').multiplyScalar(0.6 + 1.4 * night)
    stripMaterial.color.setRGB(1, 0.97, 0.92).multiplyScalar(0.15 + 3.2 * night)
  }

  return {
    object: root,
    update,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}

/** The panel at the end of the shelter: the routes that call, as a strip map. */
function drawRoutes(canvas: HTMLCanvasElement): void {
  canvas.width = 256
  canvas.height = 404
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#f3f1ea'
  ctx.fillRect(0, 0, 256, 404)
  ctx.fillStyle = '#123f7a'
  ctx.fillRect(0, 0, 256, 58)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '800 26px Manrope, "Manrope Variable", system-ui, sans-serif'
  ctx.fillText('YOʻNALISHLAR', 128, 31)
  const routes: [string, string][] = [
    ['8', '#c8312a'],
    ['27', '#1d7a46'],
    ['51', '#1d4fa3'],
    ['67', '#d9822b'],
    ['93', '#6b3fa0'],
    ['115', '#0e7c86'],
  ]
  routes.forEach(([route, color], i) => {
    const y = 92 + i * 52
    ctx.fillStyle = color
    ctx.fillRect(22, y - 18, 66, 36)
    ctx.fillStyle = '#ffffff'
    ctx.font = '800 24px Manrope, "Manrope Variable", system-ui, sans-serif'
    ctx.fillText(route, 55, y + 1)
    // The line it runs, as a row of stops.
    ctx.strokeStyle = color
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(104, y)
    ctx.lineTo(232, y)
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    for (let s = 0; s < 5; s++) {
      ctx.beginPath()
      ctx.arc(110 + s * 30, y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  })
}
