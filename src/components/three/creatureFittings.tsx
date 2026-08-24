import { createPortal } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three'
import type { Theme } from '@/theme/context'
import type { Rig } from './creatureRig'

/**
 * The parts of a creature that cannot live inside its signed distance field.
 * Sockets and the gape are carved *after* the union, so anything sitting in them
 * would be carved away too; these ride on the head bone instead.
 */

/** Reused so the tooth transforms allocate nothing per rebuild. */
const IDENTITY_QUATERNION = new Quaternion()

/**
 * Wet, near-black eyeballs parented to the head bone, so they track every turn
 * of the head for free. They cannot be part of the creature's own surface: the
 * socket is carved out of that surface, and would carve the eye out with it.
 */
export function Eyes({ rig, theme }: { rig: Rig; theme: Theme }) {
  const socket = rig.byName.get(rig.eyeBone)
  if (!socket) return null
  return createPortal(
    <>
      {rig.eyes.map((eye, i) => (
        <mesh key={i} position={eye.offset} frustumCulled={false}>
          <sphereGeometry args={[eye.radius, 18, 14]} />
          <meshPhysicalMaterial
            color={theme === 'dark' ? '#08080b' : '#141216'}
            roughness={0.09}
            metalness={0}
            clearcoat={1}
            clearcoatRoughness={0.04}
            envMapIntensity={theme === 'dark' ? 3.2 : 2.2}
          />
        </mesh>
      ))}
    </>,
    socket,
  )
}

/**
 * Teeth, as one instanced cone parented to the skull. Like the eyes they cannot
 * be part of the creature's surface — the gape is carved out of it, and would
 * carve the teeth away too.
 */
export function Teeth({ rig, theme }: { rig: Rig; theme: Theme }) {
  const socket = rig.byName.get(rig.eyeBone)
  const instances = useRef<InstancedMesh>(null)
  const teeth = rig.teeth

  useLayoutEffect(() => {
    const mesh = instances.current
    if (!mesh) return
    const m = new Matrix4()
    const q = new Quaternion()
    const flip = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI)
    teeth.forEach((tooth, i) => {
      q.copy(tooth.down ? flip : IDENTITY_QUATERNION)
      m.compose(
        new Vector3(tooth.offset[0], tooth.offset[1], tooth.offset[2]),
        q,
        new Vector3(tooth.radius, tooth.length, tooth.radius),
      )
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.count = teeth.length
  }, [teeth])

  if (!socket || teeth.length === 0) return null
  return createPortal(
    <instancedMesh ref={instances} args={[undefined, undefined, teeth.length]} frustumCulled={false}>
      {/* Unit cone: radius 1, height 1, apex toward +y. */}
      <coneGeometry args={[1, 1, 7]} />
      <meshPhysicalMaterial
        color={theme === 'dark' ? '#cdc6b4' : '#efe9db'}
        roughness={0.32}
        metalness={0}
        clearcoat={0.5}
        clearcoatRoughness={0.25}
        envMapIntensity={theme === 'dark' ? 2.4 : 1.3}
      />
    </instancedMesh>,
    socket,
  )
}

