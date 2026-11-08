import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OneFactor,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  AddEquation,
  type Camera,
  type WebGLRenderer,
} from 'three'
import { FIELD, GROUND } from './notFoundMaterials'

/**
 * Glow, for the things on the 404 page that are meant to burn.
 *
 * The usual route — render everything to a floating-point target, blur the
 * bright parts, tone-map the lot at the end — does not work here: tone mapping
 * the whole frame turns the light theme's paper grey, and the creatures' hides
 * were tuned for per-material tone mapping on the plain canvas. So the frame is
 * drawn exactly as any other scene on the site and the glow is laid over it.
 * Whatever belongs to `GLOW_LAYER` is drawn a second time on black into a small
 * target, blurred down and back up a short pyramid, and added on top.
 */

/** Objects on this layer are drawn into the glow. */
export const GLOW_LAYER = 1

const LEVELS = 4

/**
 * Height of the first glow target, whatever the canvas is. As a fraction of the
 * canvas the blur is a fixed number of pixels, so on a 5K display the glow all
 * but disappears; at a fixed height it covers the same share of any screen, and
 * the cost stops growing with the display.
 */
const WORKING_HEIGHT = 450

const FULLSCREEN = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

export interface Bloom {
  resize(width: number, height: number): void
  render(gl: WebGLRenderer, scene: Scene, camera: Camera, strength: number): void
  dispose(): void
}

export function createBloom(): Bloom {
  const orthographic = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const triangle = new BufferGeometry()
  triangle.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  const quad = new Mesh(triangle)
  quad.frustumCulled = false
  const stage = new Scene()
  stage.add(quad)

  const targets = Array.from(
    { length: LEVELS },
    (_, i) =>
      new WebGLRenderTarget(2, 2, {
        type: HalfFloatType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        generateMipmaps: false,
        // Only the first is drawn into with depth, so the columns can hide the core.
        depthBuffer: i === 0,
      }),
  )

  const down = new ShaderMaterial({
    uniforms: { tSource: { value: null }, uTexel: { value: new Vector2() } },
    vertexShader: FULLSCREEN,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSource;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSource, vUv).rgb * 4.0;
        c += texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
        c += texture2D(tSource, vUv + uTexel * vec2(1.0, -1.0)).rgb;
        c += texture2D(tSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
        c += texture2D(tSource, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(c / 8.0, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  })

  const addTogether = {
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  } as const

  const up = new ShaderMaterial({
    uniforms: { tSource: { value: null }, uTexel: { value: new Vector2() } },
    vertexShader: FULLSCREEN,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSource;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec3 c = vec3(0.0);
        c += texture2D(tSource, vUv + uTexel * vec2(-2.0, 0.0)).rgb;
        c += texture2D(tSource, vUv + uTexel * vec2(2.0, 0.0)).rgb;
        c += texture2D(tSource, vUv + uTexel * vec2(0.0, -2.0)).rgb;
        c += texture2D(tSource, vUv + uTexel * vec2(0.0, 2.0)).rgb;
        c += texture2D(tSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 2.0;
        c += texture2D(tSource, vUv + uTexel * vec2(1.0, 1.0)).rgb * 2.0;
        c += texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 2.0;
        c += texture2D(tSource, vUv + uTexel * vec2(1.0, -1.0)).rgb * 2.0;
        gl_FragColor = vec4(c / 12.0, 1.0);
      }
    `,
    ...addTogether,
  })

  const composite = new ShaderMaterial({
    uniforms: { tSource: { value: null }, uStrength: { value: 1 } },
    vertexShader: FULLSCREEN,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSource;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        vec3 c = 1.0 - exp(-texture2D(tSource, vUv).rgb * uStrength);
        gl_FragColor = vec4(pow(c, vec3(0.4545)), 1.0);
      }
    `,
    ...addTogether,
  })

  /** How much smaller the first glow target is than the canvas. */
  let glowScale = 1

  const pass = (gl: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null) => {
    quad.material = material
    gl.setRenderTarget(target)
    gl.render(stage, orthographic)
  }

  return {
    resize(width, height) {
      glowScale = Math.min(0.75, WORKING_HEIGHT / Math.max(1, height))
      targets.forEach((target, i) => {
        const level = glowScale / 2 ** i
        target.setSize(Math.max(2, Math.round(width * level)), Math.max(2, Math.round(height * level)))
      })
    },

    render(gl, scene, camera, strength) {
      const autoClear = gl.autoClear
      const mask = camera.layers.mask

      // What burns, on black.
      gl.setRenderTarget(targets[0]!)
      gl.autoClear = true
      camera.layers.set(GLOW_LAYER)
      GROUND.uGlowPass.value = 1
      // Sized in device pixels, and these are not the device's pixels.
      const pointScale = FIELD.uPointScale.value
      FIELD.uPointScale.value = pointScale * glowScale
      const background = scene.background
      scene.background = null
      gl.setClearColor(0x000000, 1)
      gl.render(scene, camera)
      scene.background = background
      FIELD.uPointScale.value = pointScale
      GROUND.uGlowPass.value = 0
      camera.layers.mask = mask

      // Down the pyramid, each level a wider blur at a quarter of the cost.
      for (let i = 1; i < LEVELS; i++) {
        const from = targets[i - 1]!
        down.uniforms.tSource!.value = from.texture
        ;(down.uniforms.uTexel!.value as Vector2).set(1 / from.width, 1 / from.height)
        pass(gl, down, targets[i]!)
      }

      // And back up, adding each blurred level into the one above it.
      gl.autoClear = false
      for (let i = LEVELS - 1; i > 0; i--) {
        const from = targets[i]!
        up.uniforms.tSource!.value = from.texture
        ;(up.uniforms.uTexel!.value as Vector2).set(0.5 / from.width, 0.5 / from.height)
        pass(gl, up, targets[i - 1]!)
      }

      // The frame itself, as on any other canvas, and the glow laid over it.
      gl.setRenderTarget(null)
      gl.autoClear = true
      gl.render(scene, camera)
      gl.autoClear = false
      composite.uniforms.tSource!.value = targets[0]!.texture
      composite.uniforms.uStrength!.value = strength
      pass(gl, composite, null)
      gl.autoClear = autoClear
    },

    dispose() {
      targets.forEach((target) => target.dispose())
      triangle.dispose()
      down.dispose()
      up.dispose()
      composite.dispose()
    },
  }
}
