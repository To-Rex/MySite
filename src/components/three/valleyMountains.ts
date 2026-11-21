import { BufferAttribute, BufferGeometry, ShaderMaterial, Sphere, Vector3 } from 'three'
import { smoothstep, valueNoise } from './valleyLand'
import { ATMOS, NOISE_GLSL, SKY } from './valleyMaterials'

/**
 * The ranges beyond the valley.
 *
 * A ring of mountains well past the end of the ground mesh, seen only where
 * they rise above its skyline: a polar grid round the camera's spot on the
 * floor, lifted by ridged multifractal noise — sharp crests, soft valleys
 * between them, the high ground rough and the low ground smooth, which is
 * roughly how erosion leaves a range — lower in front and higher behind, so
 * there are two or three ridgelines one behind the other.
 *
 * What makes them read as far away is the air in front of them. Each pixel
 * blends from the rock's own lit colour towards the light of the air — the
 * sky's own colours, from the same uniforms the dome draws with, and the glow
 * round the hidden sun on top, so the ranges on that side go pale and warm
 * while the ones opposite stay a cool blue-grey — and the thicker air low
 * down hazes the feet of the mountains more than their tops.
 * The sun is low behind them, so they are mostly seen against the light:
 * what faces it is rimmed, the rest is lit by the sky. Snow lies above a line
 * where it is not too steep to hold.
 *
 * The material writes the sky's colours as the sky does, untouched by tone
 * mapping, so where a range fades into the horizon the two meet without a
 * seam.
 */

/** Centred on the camera's spot on the floor; distances in units, angles from straight down the valley. */
export const RANGE = { x: 0, z: 16, inner: 330, outer: 575, from: -1.45, to: 1.45 } as const

const SEGMENTS = 640
const RINGS = 56

/** Ridged multifractal: each octave weighted by the one before, so crests are rough and valleys smooth. */
function ridged(x: number, z: number): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let weight = 1
  for (let i = 0; i < 6; i++) {
    let n = 1 - Math.abs(2 * valueNoise(x * freq + i * 13.1, z * freq - i * 7.7) - 1)
    n = n * n * weight
    weight = Math.min(1, n * 2.2)
    sum += n * amp
    freq *= 2.07
    amp *= 0.5
  }
  return sum
}

/** The height of the ranges at a point on the map. */
export function rangeHeight(x: number, z: number): number {
  const dx = x - RANGE.x
  const dz = z - RANGE.z
  const s = (Math.hypot(dx, dz) - RANGE.inner) / (RANGE.outer - RANGE.inner)
  const az = Math.atan2(dx, -dz)
  // Up out of the ground's own skyline into the range, higher towards the back,
  // and higher in some stretches of it than others.
  const rise = smoothstep(0, 0.3, s)
  const back = smoothstep(0.1, 0.85, s)
  const stretch = 0.75 + 0.5 * valueNoise(az * 2.3 + 5, 1.5)
  // The gap down the middle of the valley, between the near ridge and the
  // volcano, is where the eye goes; the range is highest behind it.
  const gap = Math.exp(-(((az + 0.12) / 0.3) ** 2))
  return -30 + rise * (34 + back * (30 + 58 * gap) + ridged(x * 0.0062, z * 0.0062) * (72 + back * 78) * stretch)
}

let geometry: BufferGeometry | null = null

/** Built once and kept, like the ground: a few tens of milliseconds of noise, done while the page is idle. */
export function buildRange(): BufferGeometry {
  if (geometry) return geometry
  const columns = SEGMENTS + 1
  const position = new Float32Array(columns * (RINGS + 1) * 3)
  for (let ring = 0; ring <= RINGS; ring++) {
    // Rings closer together at the front, where the silhouette is decided.
    const r = RANGE.inner + (RANGE.outer - RANGE.inner) * Math.pow(ring / RINGS, 1.4)
    for (let i = 0; i < columns; i++) {
      const az = RANGE.from + ((RANGE.to - RANGE.from) * i) / SEGMENTS
      const x = RANGE.x + Math.sin(az) * r
      const z = RANGE.z - Math.cos(az) * r
      position.set([x, rangeHeight(x, z), z], (ring * columns + i) * 3)
    }
  }
  const index: number[] = []
  for (let ring = 0; ring < RINGS; ring++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = ring * columns + i
      const b = a + columns
      // Wound so the faces look up: the other way round, the slopes facing
      // the camera were culled and the ranges floated over a band of sky.
      index.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const built = new BufferGeometry()
  built.setAttribute('position', new BufferAttribute(position, 3))
  built.setIndex(index)
  built.computeVertexNormals()
  built.boundingSphere = new Sphere(new Vector3(RANGE.x, 80, RANGE.z - RANGE.outer * 0.6), RANGE.outer)
  geometry = built
  return built
}

export function makeRangeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uLow: SKY.uLow,
      uHigh: SKY.uHigh,
      uGlow: SKY.uGlow,
      uSun: SKY.uSun,
      uLevel: ATMOS.uLevel,
      uSunDir: ATMOS.uSunDir,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLow;
      uniform vec3 uHigh;
      uniform vec3 uGlow;
      uniform float uSun;
      uniform float uLevel;
      uniform vec3 uSunDir;
      varying vec3 vWorld;
      varying vec3 vNormal;
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vNormal);
        vec3 toEye = cameraPosition - vWorld;
        float dist = length(toEye);
        vec3 view = -toEye / dist;
        float h = vWorld.y;
        float slope = 1.0 - n.y;
        // Forest low down, rock above the tree line, snow above that where it can lie.
        float vary = vvNoise(vWorld.xz * 0.02);
        vec3 rock = mix(vec3(0.15, 0.14, 0.13), vec3(0.3, 0.28, 0.25), vary);
        vec3 forest = mix(vec3(0.045, 0.07, 0.035), vec3(0.08, 0.1, 0.05), vary);
        float bare = clamp(smoothstep(55.0 + vary * 30.0, 85.0 + vary * 30.0, h) + slope * 0.35, 0.0, 1.0);
        vec3 albedo = mix(forest, rock, bare);
        float snow = smoothstep(128.0, 146.0, h + (vvNoise(vWorld.xz * 0.05) - 0.5) * 30.0) * (1.0 - smoothstep(0.3, 0.55, slope));
        albedo = mix(albedo, vec3(0.82, 0.84, 0.88), snow);
        // The low sun rims what faces it; the sky lights the rest.
        float sunLit = max(dot(n, uSunDir), 0.0);
        vec3 sky = mix(uLow, uHigh, 0.55) * (0.32 + 0.25 * n.y);
        vec3 lit = albedo * (uGlow * sunLit * 1.5 * uSun + sky) * uLevel;
        // The air between: denser low down. Its light is the sky's — cooler
        // than the horizon itself, which is lit from behind by the sun — with
        // the glow round the sun on top, so the ranges on that side go pale
        // and warm and the rest stay a hazy blue-grey.
        float T = exp(-dist * 0.0036 * exp(-max(h, 0.0) / 170.0));
        float toSun = max(dot(normalize(vec3(view.x, 0.06, view.z)), uSunDir), 0.0);
        // Capped: when the fireball whitens the sky the air in front of the
        // ranges brightens with it, but they stay a shape against it.
        vec3 air = mix(uLow, uHigh, 0.42) + uGlow * (pow(toSun, 10.0) * 0.9 + pow(toSun, 60.0) * 0.8) * min(uSun, 1.15);
        gl_FragColor = vec4(mix(air, lit, T), 1.0);
      }
    `,
    fog: false,
  })
}
