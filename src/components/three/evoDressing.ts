import { CircleGeometry, ConeGeometry, CylinderGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, ShaderMaterial } from 'three'
import type { CreatureDetail } from './creatures'
import { AIR_PARS, EVO_NOISE, airUniforms, inAir, ownShadow, type Air, type Arrivals } from './evoAir'
import { Figure } from './evoCast'
import { PLACE, groundAt, hash2 } from './evoLand'
import type { FigureLookName } from './evoLooks'
import { GAITS, applyPose, createPose, gaitPose } from './evoRig'
import type { Beat, Part } from './evoWalk'

/**
 * The smaller things the long walk passes: the water the herd drinks at, the
 * first roofs anybody put up, and the people on the pavement at the end.
 */

const POND = PLACE.pond

/** The pond: the sky lying on the ground, with the sun's road across it. */
export function createPond(air: Air): Part {
  const geometry = new CircleGeometry(POND.r * 1.04, 48)
  geometry.rotateX(-Math.PI / 2)
  const material = new ShaderMaterial({
    uniforms: airUniforms(air),
    vertexShader: /* glsl */ `
      varying vec3 vEvoWorld;
      void main() {
        vEvoWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vEvoWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${AIR_PARS}
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSunColor;
      uniform float uSunUp;
      uniform float uTime;
      ${EVO_NOISE}
      void main() {
        vec3 view = normalize(vEvoWorld - cameraPosition);
        // Ripples: two fields of noise sliding over one another, differenced into a slope. Gentle, or it is glitter.
        vec2 at = vEvoWorld.xz;
        float e = 0.35;
        float h0 = evoNoise(at * 0.9 + uTime * 0.21) + evoNoise(at * 2.3 - uTime * 0.33) * 0.5;
        float hx = evoNoise((at + vec2(e, 0.0)) * 0.9 + uTime * 0.21) + evoNoise((at + vec2(e, 0.0)) * 2.3 - uTime * 0.33) * 0.5;
        float hz = evoNoise((at + vec2(0.0, e)) * 0.9 + uTime * 0.21) + evoNoise((at + vec2(0.0, e)) * 2.3 - uTime * 0.33) * 0.5;
        vec3 n = normalize(vec3((h0 - hx) * 0.07, 1.0, (h0 - hz) * 0.07));
        vec3 bounce = reflect(view, n);
        vec3 sky = mix(uHorizon, uZenith, 1.0 - exp(-max(bounce.y, 0.0) * 3.4));
        float toSun = max(dot(bounce, uSunDir), 0.0);
        sky += uGlow * pow(toSun, 6.0) * 0.5 * uSunUp + uSunColor * pow(toSun, 420.0) * 9.0 * uSunUp;
        float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(dot(-view, n), 0.0, 1.0), 5.0);
        vec3 deep = vec3(0.012, 0.022, 0.024) * (0.4 + dot(uHorizon, vec3(0.6)));
        vec3 color = mix(deep, sky, clamp(fresnel + 0.12, 0.0, 1.0));
        gl_FragColor = vec4(evoAir(color), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new Mesh(geometry, material)
  mesh.position.set(POND.x, POND.level, POND.z)
  mesh.updateMatrix()
  mesh.matrixAutoUpdate = false
  return {
    object: mesh,
    update(beat: Beat) {
      mesh.visible = beat.p > 0.17 && beat.p < 0.62
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** Where the first roofs stand: round a middle that is left open. */
const HUTS = Array.from({ length: 9 }, (_, i) => {
  const a = (i / 9) * Math.PI * 2 + hash2(i, 5) * 0.5
  const r = 9 + hash2(i, 7) * 9
  return { x: PLACE.village.x + Math.cos(a) * r, z: PLACE.village.z + 14 + Math.sin(a) * r * 0.62, size: 0.8 + hash2(i, 11) * 0.5, delay: hash2(i, 13) * 0.6 }
})

/** The village: daub walls and thatch, going up one at a time. */
export function createVillage(air: Air, shadows: boolean): Part {
  const root = new Group()
  const wallGeometry = new CylinderGeometry(2.1, 2.2, 1.5, 12, 1, true)
  wallGeometry.translate(0, 0.75, 0)
  const roofGeometry = new ConeGeometry(2.9, 2.5, 12, 1, true)
  roofGeometry.translate(0, 2.7, 0)
  const daub = inAir(new MeshStandardMaterial({ color: '#8a7052', roughness: 1 }), air, 'daub')
  const thatch = inAir(new MeshStandardMaterial({ color: '#9a8450', roughness: 1 }), air, 'thatch')
  const walls = new InstancedMesh(wallGeometry, daub, HUTS.length)
  const roofs = new InstancedMesh(roofGeometry, thatch, HUTS.length)
  const shades: (() => void)[] = []
  for (const mesh of [walls, roofs]) {
    mesh.castShadow = shadows
    mesh.receiveShadow = shadows
    mesh.frustumCulled = false
    if (shadows) shades.push(ownShadow(mesh))
    root.add(mesh)
  }
  const dummy = new Object3D()
  let shown = -1
  return {
    object: root,
    update(beat: Beat) {
      const field = beat.stage.field
      root.visible = field > 0.01 && beat.p < 0.7
      if (!root.visible || Math.abs(field - shown) < 0.002) return
      shown = field
      HUTS.forEach((hut, i) => {
        // Each goes up in its own time, walls and roof together.
        const up = Math.min(1, Math.max(0, (field * 1.6 - hut.delay) / 0.4))
        const grown = up * up * (3 - 2 * up)
        dummy.position.set(hut.x, groundAt(hut.x, hut.z) - 0.1, hut.z)
        dummy.rotation.set(0, hash2(i, 17) * 6, 0)
        dummy.scale.set(hut.size, hut.size * grown, hut.size)
        dummy.updateMatrix()
        walls.setMatrixAt(i, dummy.matrix)
        roofs.setMatrixAt(i, dummy.matrix)
      })
      walls.instanceMatrix.needsUpdate = true
      roofs.instanceMatrix.needsUpdate = true
    },
    dispose() {
      for (const dispose of shades) dispose()
      wallGeometry.dispose()
      roofGeometry.dispose()
      daub.dispose()
      thatch.dispose()
    },
  }
}

const STREET = PLACE.city.street
const ROAD = PLACE.city.half

/** Who is on the street: which pavement, which way, how fast, and where along it they start. */
const PASSERS: readonly { z: number; going: 1 | -1; speed: number; start: number; look: FigureLookName; scale: number }[] = [
  { z: STREET - ROAD - 1.5, going: 1, speed: 1.35, start: 6, look: 'walker', scale: 1 },
  { z: STREET - ROAD - 2.9, going: -1, speed: 1.2, start: 31, look: 'passer', scale: 0.94 },
  { z: STREET - ROAD - 2.2, going: -1, speed: 1.5, start: 58, look: 'modern', scale: 1.03 },
  { z: STREET - ROAD - 1.2, going: 1, speed: 1.25, start: 44, look: 'passer', scale: 0.97 },
]
/** How far of the pavement they are kept to: from a little behind the camera to well ahead of it. */
const REACH = { behind: 12, ahead: 74 }

/** People walking the far pavement, in their own time: the city does not wait for the scroll. */
export function createPassers(air: Air & Arrivals, detail: CreatureDetail, bump: number, shadows: boolean, coat: number): Part {
  const root = new Group()
  const span = REACH.behind + REACH.ahead
  const people = PASSERS.map((who) => {
    const figure = new Figure('modern', air, { detail, look: who.look, scale: who.scale, bump, shadows, coat })
    root.add(figure.group)
    return { figure, who }
  })
  const pose = createPose()
  return {
    object: root,
    update(beat: Beat) {
      const seen = beat.stage.city > 0.86 && beat.p < 0.97
      root.visible = seen
      if (!seen) return
      for (const { figure, who } of people) {
        figure.group.visible = figure.ready
        if (!figure.byName || !figure.frame) continue
        figure.uniforms.uLight.value.copy(beat.light)
        // Kept in the stretch of pavement the camera can see, coming round again at its far end.
        const travelled = who.start + beat.t * who.speed
        const along = (((who.going * travelled - beat.shot.x + REACH.behind) % span) + span) % span
        const x = beat.shot.x - REACH.behind + along
        figure.place(x, who.z, who.going > 0 ? 0 : Math.PI, 0.07)
        figure.seen(beat.camera.position.distanceTo(figure.group.position))
        applyPose(figure.byName, gaitPose(pose, travelled / (GAITS.walk.stride * who.scale), GAITS.walk), figure.frame)
      }
    },
    dispose() {
      for (const { figure } of people) figure.dispose()
    },
  }
}
