import { createPortal } from '@react-three/fiber'
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { Matrix4, Quaternion, Vector3, type Bone, type Group, type InstancedMesh } from 'three'
import type { Theme } from '@/theme/context'
import type { Rig } from './creatureRig'
import type { CreatureTooth } from './creatures'

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
export function Eyes({ rig, theme, handle }: { rig: Rig; theme: Theme; handle?: RefObject<Group | null> }) {
  const socket = rig.byName.get(rig.eyeBone)
  if (!socket) return null
  return createPortal(
    <group ref={handle}>
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
    </group>,
    socket,
  )
}

/**
 * Teeth, as instanced cones parented to the skull — and the lower row to the jaw,
 * for the animals that have one that moves. Like the eyes they cannot be part of
 * the creature's surface: the gape is carved out of it, and would carve the
 * teeth away too.
 */
export function Teeth({ rig, theme }: { rig: Rig; theme: Theme }) {
  const skull = rig.byName.get(rig.eyeBone)
  const jaw = rig.byName.get('jaw')
  if (!skull || rig.teeth.length === 0) return null
  if (!jaw) return <ToothRow socket={skull} teeth={rig.teeth} theme={theme} />
  return (
    <>
      <ToothRow socket={skull} teeth={rig.teeth.filter((tooth) => tooth.down)} theme={theme} />
      <ToothRow socket={jaw} teeth={rig.teeth.filter((tooth) => !tooth.down)} theme={theme} origin={jaw.position} />
    </>
  )
}

function ToothRow({ socket, teeth, theme, origin }: { socket: Bone; teeth: CreatureTooth[]; theme: Theme; origin?: Vector3 }) {
  const instances = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = instances.current
    if (!mesh) return
    const m = new Matrix4()
    const q = new Quaternion()
    const flip = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI)
    // Offsets are measured from the skull; a row on another bone starts from there.
    const [ox, oy, oz] = origin ? [origin.x, origin.y, origin.z] : [0, 0, 0]
    teeth.forEach((tooth, i) => {
      q.copy(tooth.down ? flip : IDENTITY_QUATERNION)
      m.compose(
        new Vector3(tooth.offset[0] - ox, tooth.offset[1] - oy, tooth.offset[2] - oz),
        q,
        new Vector3(tooth.radius, tooth.length, tooth.radius),
      )
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.count = teeth.length
  }, [teeth, origin])

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
