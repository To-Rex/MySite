import {
  BufferAttribute,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  DoubleSide,
  Group,
  HalfFloatType,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  RGBAFormat,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import type { ValleyQuality } from '@/lib/valley'
import { EVO_NOISE, PARS_HERE, inAir, type Air } from './evoAir'
import { LAND, LAND_GRID, PLACE, grassAt, groundAt, prepareLand } from './evoLand'
import { PAVEMENT, PLAZA, ROAD, STREET_LENGTH, STREET_Z } from './evoStreet'
import type { Beat, Part } from './evoWalk'

/**
 * The steppe's grass: a meadow that is wherever the camera is.
 *
 * The valley's meadow is a fan laid out once in front of a camera that stays
 * put. This camera travels half a kilometre, so the blades here belong to the
 * ground instead: every instance has a cell of a grid that covers the whole
 * country, and draws the blade of whichever cell of its row and column is
 * nearest the camera. Move, and the blades that fall off the back of the window
 * turn up at the front as the blades that were always going to be there — no
 * blade is ever placed on the CPU, and none swims.
 *
 * Two layers: fine blades for the twenty-odd metres in front of the lens, and
 * tufts, far fewer and much wider, out to the distance where the ground's own
 * colour takes over (`evoMaterials.ts` paints the far ground the colour of
 * this). Both read where the ground is, and whether anything grows there, from
 * one small texture of the land.
 *
 * Whatever walks through it parts it: the cast hands in where its feet are.
 */

interface Layer {
  /** Blades along one side of the window, and how wide the window is in metres. */
  side: number
  span: number
  /** Segments up a blade. */
  segments: number
  width: number
}

const LAYERS: Record<ValleyQuality, readonly Layer[]> = {
  low: [],
  medium: [
    { side: 170, span: 24, segments: 2, width: 0.02 },
    { side: 190, span: 100, segments: 1, width: 0.13 },
  ],
  high: [
    { side: 250, span: 26, segments: 3, width: 0.018 },
    { side: 290, span: 135, segments: 1, width: 0.13 },
  ],
  ultra: [
    { side: 330, span: 27, segments: 4, width: 0.016 },
    { side: 380, span: 150, segments: 1, width: 0.12 },
  ],
}

/** How many things may part the grass at once. */
export const TREADS = 8

/** The land as the blades read it: height in red, where grass grows in green. */
function landTexture(): DataTexture {
  const heights = prepareLand()
  const w = LAND_GRID.cols + 1
  const h = LAND_GRID.rows + 1
  const data = new Uint16Array(w * h * 4)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const n = i + j * w
      data[n * 4] = DataUtils.toHalfFloat(heights[n]!)
      data[n * 4 + 1] = DataUtils.toHalfFloat(grassAt(LAND.x0 + i * LAND.step, LAND.z0 + j * LAND.step))
      data[n * 4 + 3] = DataUtils.toHalfFloat(1)
    }
  }
  const texture = new DataTexture(data, w, h, RGBAFormat, HalfFloatType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

function bladeGeometry(layer: Layer): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry()
  const rows = layer.segments + 1
  // Two vertices a row but the last, which is the tip: x is the side (-1, 1), y how far up (0 to 1).
  const count = layer.segments * 2 + 1
  const positions = new Float32Array(count * 3)
  for (let r = 0; r < rows - 1; r++) {
    const y = r / layer.segments
    positions.set([-1, y, 0, 1, y, 0], r * 6)
  }
  positions.set([0, 1, 0], (rows - 1) * 6)
  const indices: number[] = []
  for (let r = 0; r < layer.segments - 1; r++) {
    const a = r * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const last = (layer.segments - 1) * 2
  indices.push(last, last + 1, last + 2)
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.instanceCount = layer.side * layer.side
  return geometry
}

const GRASS_VERT_PARS = /* glsl */ `
  uniform sampler2D uLand;
  uniform vec4 uLandBox;
  uniform vec3 uFocus;
  uniform vec4 uLayer;
  uniform vec4 uWind;
  uniform float uGrow;
  uniform float uCityFrom;
  uniform float uCity;
  uniform float uPixel;
  uniform float uFade;
  uniform vec2 uNear;
  uniform vec4 uTread[${TREADS}];
  varying vec3 vBlade;
  varying vec3 vBladeNormal;
  ${EVO_NOISE}

  vec3 evoBladeAt;
  vec3 evoBladeNormal;

  void evoBlade() {
    float side = uLayer.x;
    float cell = uLayer.y / side;
    float ix = mod(float(gl_InstanceID), side);
    float iz = floor(float(gl_InstanceID) / side);
    // The cell of this instance's row and column nearest the focus: its place
    // in the world, which does not change while it is in the window.
    vec2 g = vec2(ix, iz) + side * floor((uFocus.xz / cell - vec2(ix, iz)) / side + 0.5);
    float h1 = evoHash(g);
    float h2 = evoHash(g + 17.0);
    float h3 = evoHash(g + 41.0);
    float h4 = evoHash(g + 73.0);
    vec2 root = (g + vec2(h1, h2)) * cell;

    vec4 land = texture2D(uLand, (root - uLandBox.xy) / uLandBox.zw);
    // Clumps: thick here, thin there, and nothing where nothing grows.
    float clump = evoNoise(root * 0.21) * 0.6 + evoNoise(root * 0.9) * 0.4;
    float grows = land.g * (1.0 - uCity * smoothstep(uCityFrom - 14.0, uCityFrom + 10.0, root.x));
    // And nothing comes up through a street once it is laid, or through the
    // square: the rest of the city's ground loses its grass by degrees, but
    // paving is paving from the day it goes down.
    float laid = step(root.x, uCityFrom - 18.0 + uCity * ${(1.45 * STREET_LENGTH).toFixed(1)}) * step(abs(root.y - (${STREET_Z.toFixed(2)})), ${(ROAD + PAVEMENT + 0.3).toFixed(2)});
    float paved = step(${PLAZA.x0.toFixed(1)}, root.x) * step(root.x, ${PLAZA.x1.toFixed(1)}) * step(${PLAZA.back.toFixed(1)}, root.y) * step(root.y, ${PLAZA.front.toFixed(1)});
    paved *= step(0.62 + 0.25 * clamp((${PLAZA.front.toFixed(1)} - root.y) / 66.0, 0.0, 1.0), uCity);
    grows *= 1.0 - max(laid, paved);
    float alive = step(h3, grows * (0.35 + 0.9 * clump)) * uGrow;
    // Out of the window by shrinking, never by vanishing.
    vec2 away = abs(root - uFocus.xz) / (uLayer.y * 0.5);
    alive *= 1.0 - smoothstep(uFade, 0.98, max(away.x, away.y));

    // Knee-high for the most part, waist-high in the thick of a clump, and
    // short where the ground is wet or trodden.
    float tall = (0.3 + 0.42 * h4) * (0.55 + 0.7 * clump) * (0.45 + 0.55 * smoothstep(0.2, 0.9, land.g)) * uLayer.w;
    // Trodden down round the lens. A blade a pace or two from the camera is a
    // green wall across the bottom of the frame — and, drawn over and over at
    // that size, most of what a frame low in the meadow costs.
    float trodden = smoothstep(uNear.x, uNear.y, length(root - cameraPosition.xz));
    tall *= trodden;
    float t = position.y;
    // Leaning its own way, then with the wind: a breeze, and gusts that cross the meadow.
    float yaw = h1 * 6.2831853;
    vec2 face = vec2(cos(yaw), sin(yaw));
    float gust = evoNoise(root * 0.045 - uWind.xy * uWind.z * 0.34) * 0.75 + evoNoise(root * 0.19 - uWind.xy * uWind.z * 0.55) * 0.25;
    float flutter = sin(uWind.z * (2.6 + h2 * 2.2) + h3 * 31.0) * 0.06;
    vec2 lean = face * (0.1 + 0.2 * h2) + uWind.xy * (0.12 + 0.62 * gust * uWind.w) + vec2(-uWind.y, uWind.x) * flutter;

    // Whatever is walking through it pushes it over, away from itself.
    for (int i = 0; i < ${TREADS}; i++) {
      vec2 from = root - uTread[i].xy;
      float d = length(from);
      float push = (1.0 - smoothstep(uTread[i].z * 0.35, uTread[i].z, d)) * uTread[i].w;
      lean += from / max(d, 0.05) * push * 0.95;
      tall *= 1.0 - push * 0.3;
    }

    float bend = t * t;
    float width = max(uLayer.z * (0.7 + 0.6 * h3), uPixel * length(vec3(root.x, land.r, root.y) - cameraPosition)) * (0.25 + 0.75 * trodden);
    vec3 at = vec3(root.x, land.r, root.y);
    at.xz += lean * bend * tall;
    at.y += tall * t * (1.0 - 0.32 * dot(lean, lean) * bend);
    at += vec3(-face.y, 0.0, face.x) * position.x * width * (1.0 - t * 0.85);
    evoBladeAt = mix(vec3(root.x, land.r - 0.2, root.y), at, alive);
    // Mostly the ground's normal: a blade lit as a blade is a streak of white.
    evoBladeNormal = normalize(vec3(lean.x * 0.9, 1.0, lean.y * 0.9));
    // How far up the blade, how tall it is, and how much of a patch of pale grass it stands in.
    vBlade = vec3(t, h4, clump);
  }
`

const GRASS_FRAG_PARS = /* glsl */ `
  uniform vec3 uGrassRoot;
  uniform vec3 uGrassA;
  uniform vec3 uGrassB;
  uniform vec3 uLight;
  varying vec3 vBlade;
  varying vec3 vBladeNormal;
`

export function createGrass(air: Air, quality: ValleyQuality, meadow: { a: { value: { r: number; g: number; b: number } }; b: { value: { r: number; g: number; b: number } } }): Part & {
  tread(index: number, x: number, z: number, radius: number, strength: number): void
} {
  const root = new Group()
  const layers = LAYERS[quality]
  const land = layers.length ? landTexture() : null
  const treads = Array.from({ length: TREADS }, () => new Vector4(0, 0, 1, 0))
  const shared = {
    uLand: { value: land },
    uLandBox: { value: new Vector4(LAND.x0, LAND.z0, LAND.x1 - LAND.x0, LAND.z1 - LAND.z0) },
    uWind: { value: new Vector4(0.86, 0.5, 0, 0.6) },
    uGrow: { value: 1 },
    uCityFrom: { value: PLACE.city.from },
    uCity: { value: 0 },
    uPixel: { value: 0.001 },
    uNear: { value: new Vector2(2.6, 8) },
    uTread: { value: treads },
    uGrassRoot: { value: new Vector3(0.05, 0.045, 0.02) },
    uGrassA: { value: meadow.a.value },
    uGrassB: { value: meadow.b.value },
    uLight: { value: new Vector3(1, 1, 1) },
  }
  const meshes = layers.map((layer, i) => {
    const material = new MeshLambertMaterial({ color: '#ffffff', side: DoubleSide })
    // Each layer's window is centred a different distance ahead of the camera.
    const focus = { value: new Vector3() }
    inAir(material, air, `grass${i}`, (shader) => {
      Object.assign(shader.uniforms, shared, {
        uFocus: focus,
        // The fine blades thin out over the whole outer half of their window, so
        // that from above there is no square of them; the tufts only at the rim.
        uFade: { value: i === 0 ? 0.4 : 0.84 },
        uLayer: { value: new Vector4(layer.side, layer.span, layer.width, i === 0 ? 1 : 1.06) },
      })
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GRASS_VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', 'evoBlade();\nvec3 objectNormal = evoBladeNormal;\nvBladeNormal = normalize(normalMatrix * evoBladeNormal);')
        .replace('#include <begin_vertex>', 'vec3 transformed = evoBladeAt;')
      shader.fragmentShader = shader.fragmentShader
        .replace(PARS_HERE, `${PARS_HERE}\n${GRASS_FRAG_PARS}`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          {
            vec3 tip = mix(uGrassA, uGrassB, clamp(vBlade.z * 1.5 - 0.3 + vBlade.y * 0.3, 0.0, 1.0));
            diffuseColor.rgb = mix(uGrassRoot, tip * (0.82 + 0.36 * vBlade.y), smoothstep(0.0, 0.55, vBlade.x));
          }`,
        )
        // Both faces take the ground's normal: lit by its own, the back of every blade is black.
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vBladeNormal);')
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          {
            // The low sun through the blades: brightest looking towards it.
            vec3 evoToSun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
            float through = pow(max(dot(normalize(vViewPosition), -evoToSun), 0.0), 3.0);
            totalEmissiveRadiance += diffuseColor.rgb * uLight * through * vBlade.x * 0.55;
          }`,
        )
    })
    const mesh = new Mesh(bladeGeometry(layer), material)
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    root.add(mesh)
    return { mesh, material, layer, focus }
  })

  const forward = new Vector3()
  const wind = new Vector2(0.86, 0.5).normalize()

  return {
    object: root,
    tread(index, x, z, radius, strength) {
      const slot = treads[index]
      if (slot) slot.set(x, z, radius, strength)
    },
    update(beat: Beat) {
      const seen = beat.stage.steppe > 0 && beat.p > 0.14 && layers.length > 0
      root.visible = seen
      if (!seen) return
      const camera = beat.camera
      camera.getWorldDirection(forward)
      forward.y = 0
      if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0)
      forward.normalize()
      shared.uWind.value.set(wind.x, wind.y, beat.t, 0.55 + 0.25 * Math.sin(beat.t * 0.13))
      shared.uGrow.value = beat.stage.steppe
      shared.uCity.value = beat.stage.city
      shared.uLight.value.set(beat.light.r, beat.light.g, beat.light.b)
      // A pixel's width at a metre, so no blade is ever drawn thinner than one.
      shared.uPixel.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, beat.height) * 0.75
      // Further out through a long lens, which makes what is near larger still.
      const lens = Math.min(1.7, Math.max(1, Math.tan((40 * Math.PI) / 360) / Math.tan((camera.fov * Math.PI) / 360)))
      shared.uNear.value.set(2.6 * lens, 8 * lens)
      const up = camera.position.y - groundAt(camera.position.x, camera.position.z)
      meshes.forEach(({ mesh }, i) => {
        // From a height the fine blades are less than a pixel wide and only cost.
        if (i === 0 && meshes.length > 1) mesh.visible = up < 13
      })
      for (const { layer, focus } of meshes) {
        // The window sits in front of the camera, not round it: nothing behind is seen.
        const ahead = layer.span * 0.4
        focus.value.set(camera.position.x + forward.x * ahead, 0, camera.position.z + forward.z * ahead)
      }
    },
    dispose() {
      land?.dispose()
      for (const { mesh, material } of meshes) {
        mesh.geometry.dispose()
        material.dispose()
      }
    },
  }
}
