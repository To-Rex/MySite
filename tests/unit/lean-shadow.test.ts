import { readFileSync } from 'node:fs'
import {
  BasicShadowMap,
  CubeDepthTexture,
  DepthFormat,
  DepthTexture,
  DirectionalLight,
  GreaterEqualCompare,
  LessEqualCompare,
  LinearFilter,
  NearestFilter,
  PCFShadowMap,
  PointLight,
  RedFormat,
  UnsignedByteType,
  UnsignedIntType,
  VSMShadowMap,
  WebGLCubeRenderTarget,
  WebGLRenderTarget,
  type ShadowMapType,
  type WebGLRenderer,
} from 'three'
import { describe, expect, it } from 'vitest'
import { leanShadowMap, leanShadowMaps } from '@/components/three/leanShadow'

/**
 * A light's shadow map made before three makes its own (`leanShadow.ts`): the
 * depth texture three would make, the way three sets it up, and the smallest
 * colour a framebuffer takes beside it — for the lights three would make one
 * that way for, and no other.
 */

const renderer = (type: ShadowMapType = PCFShadowMap, max = 16384, reversed = false) =>
  ({
    shadowMap: { type },
    capabilities: { maxTextureSize: max },
    state: { buffers: { depth: { getReversed: () => reversed } } },
  }) as unknown as WebGLRenderer

const sun = (size = 4096) => {
  const light = new DirectionalLight()
  light.name = 'sun'
  light.castShadow = true
  light.shadow.mapSize.set(size, size)
  return light
}

describe('a lean shadow map', () => {
  it('is the depth texture three makes, beside one 8-bit channel of colour', () => {
    const light = sun()
    expect(leanShadowMap(light, renderer())).toBe(true)
    const map = light.shadow.map!
    expect(map).toBeInstanceOf(WebGLRenderTarget)
    expect([map.width, map.height]).toEqual([4096, 4096])
    expect(map.texture.format).toBe(RedFormat)
    expect(map.texture.type).toBe(UnsignedByteType)
    const depth = map.depthTexture!
    expect(depth).toBeInstanceOf(DepthTexture)
    expect(depth.type).toBe(UnsignedIntType)
    expect(depth.format).toBe(DepthFormat)
    expect(depth.compareFunction).toBe(LessEqualCompare)
    expect([depth.minFilter, depth.magFilter]).toEqual([LinearFilter, LinearFilter])
    expect(depth.name).toBe('sun.shadowMap')
  })

  it('is a cube of depth for a point light', () => {
    const fire = new PointLight()
    fire.castShadow = true
    fire.shadow.mapSize.set(512, 512)
    expect(leanShadowMap(fire, renderer())).toBe(true)
    const map = fire.shadow.map as unknown as WebGLCubeRenderTarget
    expect(map).toBeInstanceOf(WebGLCubeRenderTarget)
    expect(map.texture.format).toBe(RedFormat)
    expect(map.depthTexture).toBeInstanceOf(CubeDepthTexture)
    expect(map.depthTexture!.compareFunction).toBe(LessEqualCompare)
  })

  it('compares the other way round where depth is reversed, and not at all for basic shadows', () => {
    const reversed = sun(1024)
    leanShadowMap(reversed, renderer(PCFShadowMap, 16384, true))
    expect(reversed.shadow.map!.depthTexture!.compareFunction).toBe(GreaterEqualCompare)
    const basic = sun(1024)
    leanShadowMap(basic, renderer(BasicShadowMap))
    expect(basic.shadow.map!.depthTexture!.compareFunction).toBeNull()
    expect(basic.shadow.map!.depthTexture!.minFilter).toBe(NearestFilter)
  })

  it('is left to three wherever three would make it some other way', () => {
    // VSM reads a colour of its own.
    expect(leanShadowMap(sun(), renderer(VSMShadowMap))).toBe(false)
    // Larger than the card takes: three shrinks the map, and so must make it.
    expect(leanShadowMap(sun(8192), renderer(PCFShadowMap, 4096))).toBe(false)
    const off = sun()
    off.castShadow = false
    expect(leanShadowMap(off, renderer())).toBe(false)
    const made = sun()
    const own = new WebGLRenderTarget(16, 16)
    made.shadow.map = own
    expect(leanShadowMap(made, renderer())).toBe(false)
    expect(made.shadow.map).toBe(own)
  })

  it('is given to every light under a root that casts a shadow', () => {
    const root = new DirectionalLight()
    root.add(sun(2048))
    const fire = new PointLight()
    fire.castShadow = true
    root.add(fire, new PointLight())
    expect(leanShadowMaps(root, renderer())).toBe(2)
  })

  it('stands on what three 0.185 does: a depth texture made this way, and only that read', () => {
    // If three changes how it makes or reads a shadow map, this is where to look again.
    const make = readFileSync('node_modules/three/src/renderers/webgl/WebGLShadowMap.js', 'utf8')
    expect(make).toContain('if ( shadow.map === null || typeChanged === true ) {')
    expect(make).toContain('shadow.map.depthTexture = new DepthTexture( _shadowMapSize.x, _shadowMapSize.y, UnsignedIntType );')
    expect(make).toContain('shadow.map.depthTexture = new CubeDepthTexture( _shadowMapSize.x, UnsignedIntType );')
    const read = readFileSync('node_modules/three/src/renderers/webgl/WebGLLights.js', 'utf8')
    expect(read).toContain('shadowMap = light.shadow.map.depthTexture || light.shadow.map.texture;')
    expect(read).toContain('if ( light.shadow.map.texture.format === RGFormat ) {')
  })
})
