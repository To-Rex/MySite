import { describe, expect, it } from 'vitest'
import { classifyRenderer } from '@/hooks/useDeviceTier'
import { valleyQuality } from '@/lib/valley'

/**
 * Who gets how much of the extinction cinematic. The renderer strings are what
 * Chrome really reports through WEBGL_debug_renderer_info.
 */

describe('the graphics card', () => {
  it.each([
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'strong'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)', 'strong'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'strong'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)', 'strong'],
    ['ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'strong'],
    ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'strong'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'modest'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'modest'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'modest'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'modest'],
    ['Apple GPU', 'modest'],
    ['Mali-G78', 'modest'],
    ['Adreno (TM) 740', 'modest'],
    ['', 'unknown'],
    ['Mozilla', 'unknown'],
  ] as const)('%s is %s', (renderer, expected) => {
    expect(classifyRenderer(renderer)).toBe(expected)
  })
})

describe('the quality of the cinematic', () => {
  it('saves ultra for a desktop with a strong card', () => {
    expect(valleyQuality('high', 'strong', false)).toBe('ultra')
    expect(valleyQuality('high', 'strong', true)).toBe('high')
    expect(valleyQuality('high', 'modest', false)).toBe('high')
    expect(valleyQuality('high', 'unknown', false)).toBe('high')
  })

  it('lets a strong card lift a machine the CPU guessed was middling', () => {
    expect(valleyQuality('medium', 'strong', false)).toBe('high')
    expect(valleyQuality('medium', 'modest', false)).toBe('medium')
  })

  it('never lifts the lowest tier, which is about more than the card', () => {
    expect(valleyQuality('low', 'strong', false)).toBe('low')
  })
})
