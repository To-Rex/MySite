import {
  BasicShadowMap,
  CubeDepthTexture,
  DepthFormat,
  DepthTexture,
  GreaterEqualCompare,
  LessEqualCompare,
  LinearFilter,
  NearestFilter,
  PCFShadowMap,
  PCFSoftShadowMap,
  RedFormat,
  UnsignedByteType,
  UnsignedIntType,
  WebGLCubeRenderTarget,
  WebGLRenderTarget,
  type DirectionalLight,
  type Object3D,
  type PointLight,
  type SpotLight,
  type WebGLRenderer,
} from 'three'

/**
 * A light's shadow map, made before three makes its own, with the least
 * colour a framebuffer will take.
 *
 * Three draws a shadow into a depth texture, and that is all it ever reads of
 * it. The render target it makes around that texture also carries a full RGBA
 * colour texture the size of the map, which nothing reads at all: at 4096 a
 * side that is 64 MB of the graphics card's memory, cleared and written back
 * every frame. Three makes a map only for a light that has none, so this one,
 * made first, is the one it draws into: the same depth texture, set up the
 * way three sets up its own (WebGLShadowMap, three 0.185), and one 8-bit
 * channel of colour — a quarter of the memory and of the bandwidth. The
 * picture is the same to the last bit, because the colour was never read.
 *
 * Only where three would make the map the same way: shadows filtered by
 * comparison or not at all (not VSM, which does read a colour), and a map no
 * larger than the card takes. Anything else is left for three to make.
 */
export function leanShadowMap(light: DirectionalLight | SpotLight | PointLight, gl: WebGLRenderer): boolean {
  const shadow = light.shadow
  if (!light.castShadow || shadow.map) return false
  const type = gl.shadowMap.type
  // Soft is turned into plain percentage-closer filtering by three itself.
  const compare = type === PCFShadowMap || type === PCFSoftShadowMap
  if (!compare && type !== BasicShadowMap) return false
  const size = shadow.mapSize
  const max = gl.capabilities.maxTextureSize
  if (size.x > max || size.y > max) return false

  const point = (light as PointLight).isPointLight === true
  const lean = { format: RedFormat, type: UnsignedByteType }
  const map = point ? new WebGLCubeRenderTarget(size.x, lean) : new WebGLRenderTarget(size.x, size.y, lean)
  // A cube of depth for a point light, as three makes it; the types know it only as a depth texture.
  const depth = point ? (new CubeDepthTexture(size.x, UnsignedIntType) as unknown as DepthTexture) : new DepthTexture(size.x, size.y, UnsignedIntType)
  depth.name = `${light.name}.shadowMap`
  depth.format = DepthFormat
  if (compare) {
    depth.compareFunction = gl.state.buffers.depth.getReversed() ? GreaterEqualCompare : LessEqualCompare
    depth.minFilter = LinearFilter
    depth.magFilter = LinearFilter
  } else {
    depth.compareFunction = null
    depth.minFilter = NearestFilter
    depth.magFilter = NearestFilter
  }
  map.depthTexture = depth
  shadow.map = map
  shadow.camera.updateProjectionMatrix()
  return true
}

/** Every light under `root` that casts a shadow, given a lean map (see `leanShadowMap`). */
export function leanShadowMaps(root: Object3D, gl: WebGLRenderer): number {
  let made = 0
  root.traverse((object) => {
    const light = object as Partial<DirectionalLight & SpotLight & PointLight>
    if ((light.isDirectionalLight || light.isSpotLight || light.isPointLight) && leanShadowMap(object as DirectionalLight | SpotLight | PointLight, gl)) made++
  })
  return made
}
