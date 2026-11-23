import {
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three'

/**
 * What a lens does to the long walk: the glow round anything bright, a little
 * darkening into the corners, and the frame put through one tone curve.
 *
 * The valley's glow is a second drawing of the things that are meant to burn,
 * laid over a frame that was tone-mapped material by material. That is right
 * for a scene that shares a page with paper; here the whole frame is the
 * scene, and nearly everything in it is lit by something brighter than white —
 * a fire, a low sun, ten thousand windows. So the scene is drawn once into a
 * floating-point frame with nothing clipped, what is brighter than white is
 * blurred down and back up a short pyramid and added back, and only then is
 * the result tone-mapped, once, on its way to the screen.
 */

const LEVELS = 5

const FULLSCREEN = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

export interface Post {
  /** What the scene is drawn into: a program has to be compiled for this, not for the screen. */
  target: WebGLRenderTarget
  resize(width: number, height: number): void
  render(gl: WebGLRenderer, scene: Scene, camera: Camera, glow: number): void
  dispose(): void
}

export function createPost(samples: number): Post {
  const orthographic = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const triangle = new BufferGeometry()
  triangle.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  const quad = new Mesh(triangle)
  quad.frustumCulled = false
  const stage = new Scene()
  stage.add(quad)

  // Only the colour is read after the scene is drawn into it: three would
  // otherwise resolve the multisampled depth too, a full-screen pass over
  // every sample of it each frame, into a buffer nothing looks at. Unresolved,
  // the driver is also told it can drop the samples' depth rather than keep it.
  const frame = new WebGLRenderTarget(2, 2, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false, samples, resolveDepthBuffer: false })
  const level = () => new WebGLRenderTarget(2, 2, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false, depthBuffer: false })
  const pyramid = Array.from({ length: LEVELS }, level)
  // A level cannot be read and written in the same pass, so each has a twin
  // the upward pass draws into, and the two change places.
  const spare = Array.from({ length: LEVELS }, level)

  // What is brighter than white, eased in so nothing has a hard edge of glow.
  const bright = new ShaderMaterial({
    uniforms: { tSource: { value: null }, uTexel: { value: new Vector2() } },
    vertexShader: FULLSCREEN,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSource;
      uniform vec2 uTexel;
      varying vec2 vUv;
      vec3 pick(vec2 uv) {
        vec3 c = min(texture2D(tSource, uv).rgb, vec3(24.0));
        float level = max(c.r, max(c.g, c.b));
        float over = max(level - 0.92, 0.0);
        return c * (over * over / (over + 0.6)) / max(level, 1e-4);
      }
      void main() {
        vec3 c = pick(vUv + uTexel * vec2(-1.0, -1.0)) + pick(vUv + uTexel * vec2(1.0, -1.0)) + pick(vUv + uTexel * vec2(-1.0, 1.0)) + pick(vUv + uTexel * vec2(1.0, 1.0));
        gl_FragColor = vec4(c * 0.25, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  })
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
  const up = new ShaderMaterial({
    uniforms: { tSource: { value: null }, tWider: { value: null }, uTexel: { value: new Vector2() } },
    vertexShader: FULLSCREEN,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSource;
      uniform sampler2D tWider;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tWider, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tWider, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        c += texture2D(tWider, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tWider, vUv + uTexel * vec2(1.0, -1.0)).rgb;
        gl_FragColor = vec4(texture2D(tSource, vUv).rgb + c * 0.25, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  })
  // The frame and its glow, darkened towards the corners, through the
  // renderer's own tone curve and out.
  const out = new ShaderMaterial({
    uniforms: { tFrame: { value: null }, tGlow: { value: null }, uGlow: { value: 1 } },
    vertexShader: FULLSCREEN,
    fragmentShader: /* glsl */ `
      uniform sampler2D tFrame;
      uniform sampler2D tGlow;
      uniform float uGlow;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tFrame, vUv).rgb + texture2D(tGlow, vUv).rgb * uGlow;
        vec2 q = vUv - 0.5;
        c *= 1.0 - dot(q, q) * 0.62;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
  })

  const draw = (gl: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null) => {
    quad.material = material
    gl.setRenderTarget(target)
    gl.render(stage, orthographic)
  }

  return {
    target: frame,
    resize(width, height) {
      const w = Math.max(2, Math.floor(width))
      const h = Math.max(2, Math.floor(height))
      frame.setSize(w, h)
      for (const set of [pyramid, spare]) set.forEach((target, i) => target.setSize(Math.max(2, w >> (i + 1)), Math.max(2, h >> (i + 1))))
    },
    render(gl, scene, camera, glow) {
      gl.setRenderTarget(frame)
      gl.render(scene, camera)

      bright.uniforms.tSource!.value = frame.texture
      ;(bright.uniforms.uTexel!.value as Vector2).set(0.5 / frame.width, 0.5 / frame.height)
      draw(gl, bright, pyramid[0]!)
      for (let i = 1; i < LEVELS; i++) {
        down.uniforms.tSource!.value = pyramid[i - 1]!.texture
        ;(down.uniforms.uTexel!.value as Vector2).set(1 / pyramid[i - 1]!.width, 1 / pyramid[i - 1]!.height)
        draw(gl, down, pyramid[i]!)
      }
      // Back up: each level takes the wider one below it and adds its own.
      for (let i = LEVELS - 2; i >= 0; i--) {
        up.uniforms.tSource!.value = pyramid[i]!.texture
        up.uniforms.tWider!.value = pyramid[i + 1]!.texture
        ;(up.uniforms.uTexel!.value as Vector2).set(1 / pyramid[i + 1]!.width, 1 / pyramid[i + 1]!.height)
        draw(gl, up, spare[i]!)
        const twin = spare[i]!
        spare[i] = pyramid[i]!
        pyramid[i] = twin
      }

      out.uniforms.tFrame!.value = frame.texture
      out.uniforms.tGlow!.value = pyramid[0]!.texture
      out.uniforms.uGlow!.value = glow
      draw(gl, out, null)
    },
    dispose() {
      triangle.dispose()
      frame.dispose()
      for (const target of pyramid) target.dispose()
      for (const target of spare) target.dispose()
      for (const material of [bright, down, up, out]) material.dispose()
    },
  }
}
