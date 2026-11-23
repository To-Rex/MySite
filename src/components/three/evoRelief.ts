import {
  BoxGeometry,
  CylinderGeometry,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three'
import { EVO_NOISE, PARS_HERE, inAir, type Air, type Shader } from './evoAir'
import { reliefOf, type Piece, type Tower } from './evoFacade'

/**
 * What stands out from the city's walls and off its roofs (`evoFacade.ts`
 * says where): coolers on their brackets, the yellow gas pipes, the shops'
 * boards, sills, cornices, parapets, the lifts' machine rooms, masts and dishes.
 *
 * Without it every block is a box with a picture of a building on each side,
 * and that is what it looks like the moment the sun is low or the eye is close:
 * nothing casts a shadow on a wall and no roof has an edge against the sky.
 * It is some fifteen hundred small instanced boxes and bars: three draws and
 * one program. Each piece goes up with its block — anything on a wall comes
 * into being as the roof goes past it, anything on the roof is carried up on
 * it — in its shadow as well as in the frame.
 */

export interface ReliefOptions {
  shadows: boolean
  /** The shops' boards: the same picture the walls draw their boards from. */
  signs: Texture
  signGrid: Vector2
}

interface Shared {
  uCity: { value: number }
  uLamps: { value: number }
  uTime: { value: number }
}

/** The pieces' rising, for every program that draws them, the shadows' included. */
const RISE_PARS = /* glsl */ `
  attribute vec4 aRise;
  uniform float uCity;
`
const RISE_VERT = /* glsl */ `
  // The block's own rising, as the walls work it out: the roof goes up past
  // floors that stay where they are.
  float evoR = smoothstep(aRise.x, aRise.x + 0.32, uCity * 1.32);
  evoR = evoR * evoR * (3.0 - 2.0 * evoR);
  float evoRoof = aRise.y + (aRise.z - aRise.y) * evoR;
  vec3 transformed = vec3(position);
  #ifdef USE_INSTANCING
    if (aRise.w < -0.5) {
      // On the roof: wherever the roof has got to.
      transformed += inverse(mat3(instanceMatrix)) * vec3(0.0, evoRoof - aRise.z, 0.0);
    } else if (aRise.w > evoRoof + 0.02) {
      // On a wall that is not up yet.
      transformed = vec3(0.0);
    }
  #endif
`

const PIECE_VERT_PARS = /* glsl */ `
  ${RISE_PARS}
  attribute vec4 aLook;
  varying vec3 vLocal;
  varying vec3 vSize;
  varying vec4 vLook;
  varying vec3 vReliefN;
`

const PIECE_VERT = /* glsl */ `
  ${RISE_VERT}
  vLocal = position;
  vLook = aLook;
  #ifdef USE_INSTANCING
    mat3 evoM = mat3(instanceMatrix);
    vSize = vec3(length(evoM[0]), length(evoM[1]), length(evoM[2]));
    vReliefN = normalize(evoM * (objectNormal / (vSize * vSize)));
  #else
    vSize = vec3(1.0);
    vReliefN = objectNormal;
  #endif
`

/**
 * The fragment's half: a colour for the piece, and how rough, and what it
 * gives off. `aLook` is (kind, a number of its own, and two more the kind
 * uses); the tint is the instance's colour.
 */
const PIECE_FRAG_PARS = /* glsl */ `
  uniform float uLamps;
  uniform sampler2D uSigns;
  uniform vec2 uSignGrid;
  varying vec3 vLocal;
  varying vec3 vSize;
  varying vec4 vLook;
  varying vec3 vReliefN;
  ${EVO_NOISE}

  float evoReliefRough;
  vec3 evoReliefGlow;

  vec3 evoLinR(vec3 c) { return pow(c, vec3(2.2)); }

  // What the street's lamps put on the bottom of a wall, and less of it higher up: as the walls have it.
  vec3 evoReliefWash(vec3 albedo, float y) {
    return albedo * vec3(1.0, 0.74, 0.46) * uLamps * (exp(-y / 6.5) * 0.5 + 0.018);
  }

  // A cooler: a pale box, a round fan grille on one side of its face and slots
  // on the other, and some of them yellowed by years of sun.
  vec3 evoCooler(vec3 m, bool front) {
    float own = vLook.y;
    vec3 body = evoLinR(mix(vec3(0.86, 0.86, 0.84), vec3(0.8, 0.76, 0.64), step(0.62, own)));
    evoReliefRough = 0.55;
    if (!front) return body * (vLocal.y < -0.49 ? 0.55 : 1.0) * (vLocal.y > 0.49 ? 0.86 : 1.0);
    vec2 c = m.xy - vec2(-vSize.x * 0.17, 0.0);
    float r = length(c);
    float R = vSize.y * 0.38;
    float px = fwidth(r);
    if (r < R) {
      float wire = 1.0 - smoothstep(0.25, 0.5, abs(fract(r / 0.024) - 0.5) * 2.0);
      float blade = smoothstep(-0.2, 0.2, sin(atan(c.y, c.x) * 3.0 + r * 9.0));
      vec3 inside = evoLinR(vec3(0.05)) * (0.6 + 0.6 * blade * step(r, R * 0.8));
      return mix(inside, body * 0.85, mix(wire, 0.4, smoothstep(0.006, 0.02, px)));
    }
    if (r < R + 0.025) return body * 0.7;
    // The slots, on the other side.
    if (m.x > vSize.x * 0.12 && m.x < vSize.x * 0.44 && abs(m.y) < vSize.y * 0.36) {
      float slot = step(0.55, fract(m.y / 0.03));
      return body * mix(1.0 - 0.45 * slot, 0.8, smoothstep(0.004, 0.012, fwidth(m.y)));
    }
    // And a stain down the wall from it is the wall's affair; the box is only grubby.
    return body * (0.9 + 0.1 * evoNoise(m.xy * 20.0 + own * 50.0));
  }

  vec3 evoReliefColor() {
    float kind = vLook.x;
    vec3 m = vLocal * vSize;
    bool front = vLocal.z > 0.49;
    evoReliefRough = 0.85;
    evoReliefGlow = vec3(0.0);
    if (kind < 0.5) return evoCooler(m, front);
    if (kind < 1.5) {
      // A gas meter's box: grey, a little window in its door.
      evoReliefRough = 0.5;
      vec3 box = evoLinR(vec3(0.6, 0.6, 0.58));
      if (front && abs(m.x) < 0.07 && abs(m.y - 0.06) < 0.045) return evoLinR(vec3(0.12, 0.14, 0.15));
      return box;
    }
    if (kind < 2.5) {
      // Concrete or stone, the block's own, darker where the rain sits.
      vec3 tint = vec3(vLook.z, vLook.w, vLook.y);
      float grain = 0.86 + 0.22 * evoNoise(vEvoWorld.xz * 1.4 + vEvoWorld.y * 0.9);
      return tint * grain * (vLocal.y > 0.49 ? 0.82 : 1.0) * (vLocal.y < -0.49 ? 0.88 : 1.0);
    }
    if (kind < 3.5) {
      // A shop's board: the picture on its face, lit from inside after dark; its edges aluminium.
      evoReliefRough = 0.45;
      if (!front) return evoLinR(vec3(0.2, 0.21, 0.22));
      vec2 suv = clamp(vLocal.xy + 0.5, 0.0, 1.0);
      float which = vLook.y;
      vec2 cell = vec2(mod(which, uSignGrid.x), uSignGrid.y - 1.0 - floor(which / uSignGrid.x));
      vec3 board = texture2D(uSigns, (cell + suv) / uSignGrid).rgb;
      // A frame round the face.
      float edge = min(min(m.x + vSize.x * 0.5, vSize.x * 0.5 - m.x), min(m.y + vSize.y * 0.5, vSize.y * 0.5 - m.y));
      if (edge < 0.035) return evoLinR(vec3(0.2, 0.21, 0.22));
      evoReliefGlow = board * (0.1 + 2.3 * smoothstep(0.05, 0.3, uLamps));
      return board * 0.7;
    }
    if (kind > 5.5) {
      // An awning: stripes of its colour and white, along it; paler underneath,
      // where the shop's light falls on it after dark.
      evoReliefRough = 0.95;
      vec3 tint = vec3(vLook.z, vLook.w, vLook.y);
      float along = m.x / 0.34;
      float stripe = mix(step(0.5, fract(along)), 0.5, smoothstep(0.2, 0.6, fwidth(along)));
      vec3 cloth = mix(evoLinR(vec3(0.9, 0.88, 0.82)), tint, stripe) * (0.9 + 0.1 * evoNoise(m.xz * 6.0));
      if (vLocal.y < -0.4) evoReliefGlow = cloth * vec3(1.0, 0.86, 0.66) * 0.35 * smoothstep(0.08, 0.3, uLamps);
      return cloth;
    }
    if (kind < 4.5) {
      // Pipes and masts: painted, and the paint not new.
      evoReliefRough = 0.5;
      vec3 tint = vec3(vLook.z, vLook.w, vLook.y);
      return tint * (0.82 + 0.2 * evoNoise(vEvoWorld.xz * 3.0 + vEvoWorld.y * 3.0));
    }
    // A dish: pale grey, a little shiny.
    evoReliefRough = 0.4;
    return evoLinR(vec3(0.78, 0.78, 0.76));
  }
`

/** Gives a material the pieces' rising, and its depth and distance materials the same, so shadows rise too. */
function withRise(material: Material, shared: Shared, key: string): void {
  material.onBeforeCompile = (shader: Shader) => {
    shader.uniforms.uCity = shared.uCity
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${RISE_PARS}`)
      .replace('#include <begin_vertex>', RISE_VERT)
  }
  material.customProgramCacheKey = () => `evo:relief-${key}`
}

const KINDS: Record<Piece['kind'], number> = { cooler: 0, meter: 1, masonry: 2, sign: 3, pipe: 4, mast: 4, dish: 5, awning: 6 }

export interface Relief {
  object: Group
  /**
   * Whether the pieces cast shadows now. By moonlight a cooler's shadow is
   * not to be seen, and drawing all of them into the shadow map anyway is
   * a share of every night frame for nothing.
   */
  castShadows(on: boolean): void
  dispose(): void
}

export function createRelief(blocks: readonly Tower[], shared: Shared, air: Air, options: ReliefOptions): Relief {
  const root = new Group()
  const disposers: (() => void)[] = []
  const pieces = reliefOf(blocks, options.signGrid.x * options.signGrid.y)

  // One program for every piece, whatever its shape: they differ only in
  // what they are handed, and each program is one more for the warm-up to
  // build and the graphics card to make ready.
  const material = (): MeshStandardMaterial =>
    inAir(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0 }), air, 'relief', (shader) => {
      Object.assign(shader.uniforms, { uCity: shared.uCity, uLamps: shared.uLamps, uSigns: { value: options.signs }, uSignGrid: { value: options.signGrid } })
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${PIECE_VERT_PARS}`)
        .replace('#include <begin_vertex>', PIECE_VERT)
      shader.fragmentShader = shader.fragmentShader
        .replace(PARS_HERE, `${PARS_HERE}\n${PIECE_FRAG_PARS}`)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = evoReliefColor();')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = evoReliefRough;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += evoReliefGlow + evoReliefWash(diffuseColor.rgb, vEvoWorld.y);',
        )
    })

  const matrix = new Matrix4()
  const turn = new Quaternion()
  const tilt = new Quaternion()
  const at = new Vector3()
  const size = new Vector3()

  /** One instanced mesh of one shape, for every piece `which` picks. */
  const mesh = (geometry: BufferGeometry, which: (piece: Piece) => boolean, place: (piece: Piece) => void): void => {
    const mine = pieces.filter(which)
    if (mine.length === 0) {
      geometry.dispose()
      return
    }
    const rise = new Float32Array(mine.length * 4)
    const look = new Float32Array(mine.length * 4)
    const drawn = new InstancedMesh(geometry, material(), mine.length)
    mine.forEach((piece, i) => {
      place(piece)
      drawn.setMatrixAt(i, matrix)
      const t = blocks[piece.tower]!
      rise.set([t.delay, t.base, t.h, piece.roof ? -1 : piece.y + piece.h / 2], i * 4)
      const tint = piece.tint ?? [0.8, 0.8, 0.8]
      // (kind, its own number — or for a board, which — and the tint, as two and one)
      look.set([KINDS[piece.kind], piece.kind === 'sign' ? (piece.sign ?? 0) : piece.kind === 'cooler' ? fract(piece.x * 0.37 + piece.y * 0.71) : tint[2], tint[0], tint[1]], i * 4)
    })
    geometry.setAttribute('aRise', new InstancedBufferAttribute(rise, 4))
    geometry.setAttribute('aLook', new InstancedBufferAttribute(look, 4))
    drawn.instanceMatrix.needsUpdate = true
    drawn.frustumCulled = false
    drawn.castShadow = options.shadows
    drawn.receiveShadow = options.shadows
    if (options.shadows) {
      const depth = new MeshDepthMaterial()
      const distance = new MeshDistanceMaterial()
      withRise(depth, shared, 'depth')
      withRise(distance, shared, 'distance')
      drawn.customDepthMaterial = depth
      drawn.customDistanceMaterial = distance
      disposers.push(() => depth.dispose(), () => distance.dispose())
    }
    root.add(drawn)
    disposers.push(() => geometry.dispose(), () => (drawn.material as Material).dispose())
  }

  // Boxes: coolers, meters, masonry, and the boards.
  const boxPlace = (piece: Piece) => {
    turn.setFromAxisAngle(UP, piece.facing)
    if (piece.tilt) turn.multiply(tilt.setFromAxisAngle(ACROSS, piece.tilt))
    matrix.compose(at.set(piece.x, piece.y, piece.z), turn, size.set(piece.w, piece.h, piece.d))
  }
  mesh(new BoxGeometry(1, 1, 1), (p) => p.kind === 'cooler' || p.kind === 'meter' || p.kind === 'masonry' || p.kind === 'sign' || p.kind === 'awning', boxPlace)

  // Bars: pipes and masts, a cylinder along its own axis.
  mesh(
    new CylinderGeometry(0.5, 0.5, 1, 8, 1),
    (p) => p.kind === 'pipe' || p.kind === 'mast',
    (piece) => {
      turn.setFromAxisAngle(UP, piece.facing)
      if (piece.axis === 'along') {
        tilt.setFromEuler(LAY_ALONG)
        size.set(piece.h, piece.w, piece.d)
      } else if (piece.axis === 'out') {
        tilt.setFromEuler(LAY_OUT)
        size.set(piece.w, piece.d, piece.h)
      } else {
        tilt.identity()
        size.set(piece.w, piece.h, piece.d)
      }
      matrix.compose(at.set(piece.x, piece.y, piece.z), turn.multiply(tilt), size)
    },
  )

  // Dishes: a shallow bowl, turned out from the wall and up to the sky.
  const bowl = new LatheGeometry(
    [0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.5].map((r) => new Vector2(r, r * r * 0.5)),
    14,
  )
  bowl.translate(0, -0.06, 0)
  mesh(
    bowl,
    (p) => p.kind === 'dish',
    (piece) => {
      turn.setFromAxisAngle(UP, piece.facing)
      tilt.setFromEuler(DISH_TILT)
      matrix.compose(at.set(piece.x, piece.y, piece.z), turn.multiply(tilt), size.set(piece.w, piece.w, piece.w))
    },
  )

  const casting = root.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh)
  return {
    object: root,
    castShadows(on: boolean) {
      const cast = on && options.shadows
      for (const mesh of casting) mesh.castShadow = cast
    },
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}

const UP = new Vector3(0, 1, 0)
/** The line along a wall, about which an awning is tipped. */
const ACROSS = new Vector3(1, 0, 0)
/** A bar laid along the wall: its length, which is y, turned to x. */
const LAY_ALONG = new Euler(0, 0, Math.PI / 2)
/** And out of it: y turned to z. */
const LAY_OUT = new Euler(Math.PI / 2, 0, 0)
/** A dish's bowl opens up y; turned out from the wall and up at the sky. */
const DISH_TILT = new Euler(Math.PI / 2 - 0.55, 0, 0)
const fract = (v: number) => v - Math.floor(v)
