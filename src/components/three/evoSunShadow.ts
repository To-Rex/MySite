import { DepthTexture, LessEqualCompare, Matrix4, NearestFilter, Vector4, type Camera, type DirectionalLight, type Object3D, type Scene, type Texture } from 'three'

/**
 * The sun's shadow, for the walk's own shaders.
 *
 * Three's materials take the shadow map of a light that casts one by
 * themselves. The ground of the street, the floor of the square and the
 * mosque are drawn by shaders of this scene's own, which light themselves
 * from two colours and a direction so that there is one program for each
 * whatever lamps are lit — and so take no shadows unless they are handed the
 * map. This hands it to them: the map, the matrix that finds a point in it,
 * and whether there is one at all (there is none on the lowest setting).
 *
 * Nothing here knows where the sun is. The first time a mesh bound to it is
 * drawn, it looks through the scene for the light that casts a shadow, and
 * after that reads the map and the matrix off that light every frame, just
 * before the mesh is drawn — by which time three has drawn the map for that
 * frame and moved the matrix with it.
 */

export interface SunShadowUniforms {
  uSunShadow: { value: Texture | null }
  uSunShadowMatrix: { value: Matrix4 }
  /** Whether there is a map (0 or 1), how soft its edges are (as a share of its width), and its depth bias. */
  uSunShadowInfo: { value: Vector4 }
}

export interface SunShadow {
  uniforms: SunShadowUniforms
  /** Keeps the uniforms in step with the sun's map whenever this mesh is drawn. */
  bind(mesh: Object3D): void
  dispose(): void
}

/**
 * `soft` is how far, in metres, the edge of a shadow is spread: a shadow's
 * edge is never a line, since the sun is not a point, and the farther the
 * thing that throws it the wider; a few centimetres is the street's middle.
 */
export function createSunShadow(soft = 0.07): SunShadow {
  const uniforms: SunShadowUniforms = {
    uSunShadow: { value: null },
    uSunShadowMatrix: { value: new Matrix4() },
    uSunShadowInfo: { value: new Vector4(0, 0, 0, 0) },
  }
  // What the sampler is given when there is no map. It must be a depth
  // texture that compares, or the graphics card will not draw with it at all,
  // sampled or not; three's own stand-in for one is never given any memory.
  const none = new DepthTexture(1, 1)
  none.compareFunction = LessEqualCompare
  none.minFilter = NearestFilter
  none.magFilter = NearestFilter
  none.needsUpdate = true
  uniforms.uSunShadow.value = none
  let sun: DirectionalLight | null | undefined
  const sync = (scene: Scene): void => {
    if (sun === undefined) {
      sun = null
      scene.traverse((object) => {
        const light = object as DirectionalLight
        if (sun === null && light.isDirectionalLight && light.castShadow) sun = light
      })
    }
    const map = sun?.castShadow ? (sun.shadow.map?.depthTexture ?? null) : null
    uniforms.uSunShadow.value = map ?? none
    if (sun && map) uniforms.uSunShadowMatrix.value = sun.shadow.matrix
    const box = sun?.shadow.camera
    const wide = box ? Math.max(1e-3, box.right - box.left) : 1
    // Never less than a texel and a half of the map, or five samples are five steps.
    const texels = 1.5 / Math.max(1, sun?.shadow.mapSize.x ?? 1)
    uniforms.uSunShadowInfo.value.set(map ? 1 : 0, Math.max(soft / wide, texels), sun?.shadow.bias ?? 0, 0)
  }
  return {
    uniforms,
    bind(mesh) {
      const before = mesh.onBeforeRender.bind(mesh)
      mesh.onBeforeRender = (renderer, scene: Scene, camera: Camera, geometry, material, group) => {
        sync(scene)
        before(renderer, scene, camera, geometry, material, group)
      }
    },
    dispose: () => none.dispose(),
  }
}

/**
 * The same in GLSL: `evoSunSeen(at, n)` is how much of the sun reaches the
 * point `at` on a surface facing `n`, 0 to 1. Soft at the edges — five
 * samples of the map, each one filtered by the hardware, turned a different
 * way at every pixel — and faded out to nothing at the rim of the box the map
 * covers, so that where it stops is never a line on the ground.
 *
 * `evoSunSeenLod` is the same with one filtered sample, for a vertex shader.
 */
export const SUN_SHADOW_GLSL = /* glsl */ `
  uniform sampler2DShadow uSunShadow;
  uniform mat4 uSunShadowMatrix;
  uniform vec4 uSunShadowInfo;

  // Where a point is in the map, and how far inside its rim, 0 at the rim.
  vec4 evoShadowAt(vec3 at, vec3 n) {
    vec4 c = uSunShadowMatrix * vec4(at + n * 0.06, 1.0);
    vec3 s = c.xyz / c.w;
    vec2 rim = min(s.xy, 1.0 - s.xy);
    return vec4(s.xy, s.z + uSunShadowInfo.z, s.z < 1.0 ? min(rim.x, rim.y) : -1.0);
  }

  float evoSunSeenLod(vec3 at, vec3 n) {
    if (uSunShadowInfo.x < 0.5) return 1.0;
    vec4 s = evoShadowAt(at, n);
    if (s.w <= 0.0) return 1.0;
    float seen = texture(uSunShadow, s.xyz);
    return mix(1.0, seen, smoothstep(0.0, 0.1, s.w));
  }

  #ifdef EVO_FRAGMENT
  float evoSunSeen(vec3 at, vec3 n) {
    if (uSunShadowInfo.x < 0.5) return 1.0;
    vec4 s = evoShadowAt(at, n);
    if (s.w <= 0.0) return 1.0;
    float radius = uSunShadowInfo.y;
    // Turned a different way at every pixel, so five samples read as a soft
    // edge and not as five; and further off, where a soft edge is a pixel or
    // two wide anyway, two.
    float phi = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
    int taps = length(at - cameraPosition) < 14.0 ? 5 : 2;
    float sum = 0.0;
    for (int i = 0; i < 5; i++) {
      if (i >= taps) break;
      float r = sqrt((float(i) + 0.5) / float(taps)) * radius;
      float a = float(i) * 2.3999632 + phi;
      sum += texture(uSunShadow, vec3(s.xy + vec2(cos(a), sin(a)) * r, s.z));
    }
    return mix(1.0, sum / float(taps), smoothstep(0.0, 0.1, s.w));
  }
  #endif
`
