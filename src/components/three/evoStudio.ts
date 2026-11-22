import {
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  SRGBColorSpace,
  type Material,
} from 'three'
import type { CreatureDetail } from './creatures'
import { inAir, type Air, type Arrivals } from './evoAir'
import { Figure } from './evoCast'
import { STUDIO, towers } from './evoCity'
import { PLACE, hash2 } from './evoLand'
import { applyPose, createPose, deskPose } from './evoRig'
import type { Beat, Part } from './evoWalk'

/**
 * Where the walk ends: one lit room on the street, and somebody in it at a desk.
 *
 * It is the ground floor of one of the city's own buildings — `towers()` lifts
 * that one off the ground, and this fills the gap: a room open to the street
 * behind a sheet of glass, the solid ground floor either side of it, and
 * inside a desk, a lamp, shelves, and a person typing. The camera comes across
 * the road, through the glass and over a shoulder, and ends inside the
 * monitor — which is the colour of the page, because the page is what is on it.
 */

const AT = PLACE.studio
const FLOOR = 0.1

/** Where the monitor's screen is: its middle, and its size. The script's last camera key looks here. */
export const SCREEN = { x: AT.x - 0.1, y: 1.26, z: AT.z - 2.56, width: 0.62, height: 0.36 } as const

/** Lines of something being written: not text, the look of text. */
function drawEditor(canvas: HTMLCanvasElement, paper: string, ink: string, accent: string): void {
  const g = canvas.getContext('2d')
  if (!g) return
  const { width: w, height: h } = canvas
  g.fillStyle = paper
  g.fillRect(0, 0, w, h)
  const dim = (alpha: number) => {
    g.globalAlpha = alpha
    g.fillStyle = ink
  }
  // A strip of files down the left, tabs along the top.
  dim(0.05)
  g.fillRect(0, 0, w * 0.17, h)
  g.fillRect(0, 0, w, h * 0.055)
  for (let i = 0; i < 13; i++) {
    dim(i === 4 ? 0.5 : 0.2)
    g.fillRect(w * 0.025 + (i % 3 === 0 ? 0 : w * 0.015), h * (0.1 + i * 0.045), w * (0.05 + hash2(i, 3) * 0.07), h * 0.012)
  }
  const palette = [ink, accent, '#7fa7c9', '#9bbf8a', ink, '#c98f7f']
  let indent = 0
  for (let row = 0; row < 26; row++) {
    const y = h * (0.1 + row * 0.033)
    if (hash2(row, 7) < 0.14) continue
    indent = Math.max(0, Math.min(4, indent + (hash2(row, 11) < 0.3 ? 1 : hash2(row, 13) < 0.3 ? -1 : 0)))
    let x = w * (0.2 + indent * 0.022)
    const words = 2 + Math.floor(hash2(row, 17) * 5)
    for (let k = 0; k < words; k++) {
      const len = w * (0.02 + hash2(row * 9 + k, 19) * 0.085)
      g.globalAlpha = 0.34 + hash2(row * 9 + k, 23) * 0.4
      g.fillStyle = palette[Math.floor(hash2(row * 9 + k, 29) * palette.length)] ?? ink
      g.fillRect(x, y, len, h * 0.013)
      x += len + w * 0.012
      if (x > w * 0.82) break
    }
  }
  g.globalAlpha = 1
}

export function createStudio(air: Air & Arrivals, detail: CreatureDetail, bump: number): Part & { setPaper(paper: string, ink: string, accent: string): void } {
  const root = new Group()
  const disposers: (() => void)[] = []
  const keep = <T extends { dispose(): void }>(thing: T): T => {
    disposers.push(() => thing.dispose())
    return thing
  }
  const solid = (color: string, roughness = 0.85, key = color): MeshStandardMaterial => keep(inAir(new MeshStandardMaterial({ color, roughness, metalness: 0 }), air, `studio:${key}`))
  const add = (geometry: BoxGeometry | PlaneGeometry | CylinderGeometry | SphereGeometry | ConeGeometry, material: Material, x: number, y: number, z: number): Mesh => {
    const mesh = new Mesh(keep(geometry), material)
    mesh.position.set(x, y, z)
    root.add(mesh)
    return mesh
  }
  const x0 = AT.x
  const zFront = AT.z + 2
  const zBack = zFront - STUDIO.depth
  const zMid = (zFront + zBack) / 2

  // ---- the shell: a room seen from inside, and the ground floor round it ----
  const plaster = solid('#d9d0c2', 0.95, 'plaster')
  plaster.side = BackSide
  // A hand's width inside the masonry round it, so the two never share a plane.
  add(new BoxGeometry(STUDIO.width - 0.06, STUDIO.height - 0.06, STUDIO.depth - 0.06), plaster, x0, FLOOR + STUDIO.height / 2, zMid)
  const boards = solid('#5b4331', 0.6, 'boards')
  const floor = add(new PlaneGeometry(STUDIO.width - 0.06, STUDIO.depth - 0.06), boards, x0, FLOOR + 0.045, zMid)
  floor.rotation.x = -Math.PI / 2
  const rug = add(new PlaneGeometry(2.6, 1.7), solid('#7a3b2c', 1, 'rug'), x0 + 0.35, FLOOR + 0.058, zBack + 1.75)
  rug.rotation.x = -Math.PI / 2
  // What is left of the building's ground floor either side, and the beam over the glass.
  const home = towers().find((tower) => tower.base > 0)
  const stone = solid('#3a3835', 0.9, 'stone')
  if (home) {
    const left = home.x - home.w / 2
    const right = home.x + home.w / 2
    const roomLeft = x0 - STUDIO.width / 2
    const roomRight = x0 + STUDIO.width / 2
    const depth = home.d
    const zBlock = zFront - depth / 2
    add(new BoxGeometry(roomLeft - left, home.base, depth), stone, (left + roomLeft) / 2, home.base / 2, zBlock)
    add(new BoxGeometry(right - roomRight, home.base, depth), stone, (right + roomRight) / 2, home.base / 2, zBlock)
    add(new BoxGeometry(STUDIO.width, home.base - STUDIO.height - FLOOR, depth), stone, x0, (home.base + STUDIO.height + FLOOR) / 2, zBlock)
    add(new BoxGeometry(STUDIO.width, STUDIO.height + FLOOR, depth - STUDIO.depth), stone, x0, (STUDIO.height + FLOOR) / 2, zBack - (depth - STUDIO.depth) / 2)
    add(new BoxGeometry(STUDIO.width, FLOOR, STUDIO.depth), stone, x0, FLOOR / 2, zMid)
  }
  // The glass, in a thin dark frame with one upright in it.
  const frame = solid('#17181a', 0.5, 'frame')
  add(new BoxGeometry(STUDIO.width, 0.09, 0.09), frame, x0, FLOOR + STUDIO.height - 0.045, zFront)
  add(new BoxGeometry(STUDIO.width, 0.12, 0.09), frame, x0, FLOOR + 0.06, zFront)
  for (const dx of [-STUDIO.width / 2 + 0.045, 1.9, STUDIO.width / 2 - 0.045]) add(new BoxGeometry(0.09, STUDIO.height, 0.09), frame, x0 + dx, FLOOR + STUDIO.height / 2, zFront)
  const glass = keep(new MeshStandardMaterial({ color: '#b9d2e2', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false }))
  const pane = add(new PlaneGeometry(STUDIO.width, STUDIO.height), glass, x0, FLOOR + STUDIO.height / 2, zFront)
  pane.renderOrder = 8

  // ---- the desk, and what is on it ----------------------------------------
  const wood = solid('#8a6a48', 0.55, 'wood')
  const dark = solid('#15161a', 0.5, 'dark')
  const deskZ = zBack + 0.72
  const deskX = x0 + 0.25
  add(new BoxGeometry(2.1, 0.045, 0.86), wood, deskX, FLOOR + 0.745, deskZ)
  for (const [dx, dz] of [[-0.98, -0.36], [0.98, -0.36], [-0.98, 0.36], [0.98, 0.36]] as const) add(new BoxGeometry(0.05, 0.72, 0.05), dark, deskX + dx, FLOOR + 0.36, deskZ + dz)
  // The monitor: a bezel, a foot, and the screen the walk ends in.
  const paper = document.createElement('canvas')
  paper.width = 1024
  paper.height = 600
  const page = keep(new CanvasTexture(paper))
  page.colorSpace = SRGBColorSpace
  const screenMaterial = keep(new MeshBasicMaterial({ map: page, toneMapped: false }))
  add(new BoxGeometry(SCREEN.width + 0.03, SCREEN.height + 0.03, 0.025), dark, SCREEN.x, SCREEN.y, SCREEN.z - 0.016)
  add(new PlaneGeometry(SCREEN.width, SCREEN.height), screenMaterial, SCREEN.x, SCREEN.y, SCREEN.z)
  add(new BoxGeometry(0.05, 0.3, 0.04), dark, SCREEN.x, FLOOR + 0.92, SCREEN.z - 0.04)
  add(new BoxGeometry(0.26, 0.015, 0.18), dark, SCREEN.x, FLOOR + 0.775, SCREEN.z - 0.02)
  // A laptop in front of whoever is typing, open, with its own small light.
  const seatX = x0 + 0.62
  const lapZ = deskZ + 0.06
  add(new BoxGeometry(0.34, 0.016, 0.24), solid('#a9adb3', 0.4, 'alloy'), seatX, FLOOR + 0.776, lapZ)
  const lid = add(new BoxGeometry(0.34, 0.23, 0.012), solid('#a9adb3', 0.4, 'alloy'), seatX, FLOOR + 0.885, lapZ - 0.15)
  lid.rotation.x = -0.26
  const lapPaper = document.createElement('canvas')
  lapPaper.width = 512
  lapPaper.height = 340
  const lapPage = keep(new CanvasTexture(lapPaper))
  lapPage.colorSpace = SRGBColorSpace
  const lapScreen = add(new PlaneGeometry(0.31, 0.2), keep(new MeshBasicMaterial({ map: lapPage, toneMapped: false })), seatX, FLOOR + 0.887, lapZ - 0.142)
  lapScreen.rotation.x = -0.26
  // A mug, a lamp on the desk, a plant in the corner.
  add(new CylinderGeometry(0.04, 0.035, 0.09, 10), solid('#d8d3c8', 0.4, 'mug'), deskX - 0.72, FLOOR + 0.815, deskZ + 0.2)
  add(new CylinderGeometry(0.16, 0.13, 0.3, 10), solid('#6d5a46', 0.9, 'pot'), x0 - 3.2, FLOOR + 0.15, zBack + 0.5)
  for (let i = 0; i < 5; i++) {
    const leaf = add(new ConeGeometry(0.1 + hash2(i, 41) * 0.05, 0.75 + hash2(i, 43) * 0.5, 5), solid('#2f4a2c', 0.8, 'leaf'), x0 - 3.2 + (hash2(i, 47) - 0.5) * 0.3, FLOOR + 0.75, zBack + 0.5 + (hash2(i, 53) - 0.5) * 0.3)
    leaf.rotation.set((hash2(i, 59) - 0.5) * 0.9, 0, (hash2(i, 61) - 0.5) * 0.9)
  }
  // Shelves on the back wall with a row of books on each.
  const spines = ['#7a2e24', '#27455e', '#c9b27a', '#2f4a3a', '#d8d3c8', '#5a3a5e', '#b0652a']
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = FLOOR + 1.55 + shelf * 0.5
    add(new BoxGeometry(2.3, 0.035, 0.24), wood, x0 - 2.25, y, zBack + 0.13)
    let x = x0 - 3.3
    for (let i = 0; i < 16 && x < x0 - 1.25; i++) {
      const thick = 0.03 + hash2(i + shelf * 31, 67) * 0.045
      const tall = 0.22 + hash2(i + shelf * 31, 71) * 0.12
      if (hash2(i + shelf * 31, 73) > 0.18) {
        add(new BoxGeometry(thick, tall, 0.17), solid(spines[Math.floor(hash2(i + shelf * 31, 79) * spines.length)] ?? '#888888', 0.8), x + thick / 2, y + 0.018 + tall / 2, zBack + 0.13)
      }
      x += thick + 0.006
    }
  }
  // A chair.
  const seatZ = deskZ + 0.72
  add(new BoxGeometry(0.46, 0.06, 0.46), dark, seatX, FLOOR + 0.5, seatZ)
  add(new BoxGeometry(0.44, 0.5, 0.05), dark, seatX, FLOOR + 0.82, seatZ + 0.24)
  add(new CylinderGeometry(0.03, 0.03, 0.44, 8), dark, seatX, FLOOR + 0.25, seatZ)
  add(new CylinderGeometry(0.28, 0.28, 0.03, 12), dark, seatX, FLOOR + 0.03, seatZ)

  // ---- light ---------------------------------------------------------------
  const shadeMaterial = keep(new MeshBasicMaterial({ color: '#ffffff' }))
  add(new SphereGeometry(0.16, 14, 10), shadeMaterial, x0 - 0.6, FLOOR + STUDIO.height - 0.75, zMid + 0.3)
  add(new CylinderGeometry(0.008, 0.008, 0.6, 5), dark, x0 - 0.6, FLOOR + STUDIO.height - 0.3, zMid + 0.3)
  const lamp = keep(new PointLight('#ffc78a', 0, 11, 1.6))
  lamp.position.set(x0 - 0.6, FLOOR + STUDIO.height - 0.85, zMid + 0.3)
  // The screen's own light, on the face in front of it.
  const glow = keep(new PointLight('#bcd0ff', 0, 3.2, 1.8))
  glow.position.set(SCREEN.x + 0.25, SCREEN.y, SCREEN.z + 0.4)
  root.add(lamp, glow)

  // ---- whoever it is -------------------------------------------------------
  const person = new Figure('modern', air, 'studio', { detail, look: 'modern', bump, shadows: false })
  root.add(person.group)
  disposers.push(() => person.dispose())
  const pose = createPose()
  const screenTint = new Color('#bcd0ff')

  return {
    object: root,
    setPaper(sheet, ink, accent) {
      drawEditor(paper, sheet, ink, accent)
      drawEditor(lapPaper, sheet, ink, accent)
      page.needsUpdate = true
      lapPage.needsUpdate = true
      // A pale page lights the face more than a dark one does.
      screenTint.set(sheet).lerp(new Color('#bcd0ff'), 0.6)
    },
    update(beat: Beat) {
      const seen = beat.stage.city > 0.9
      root.visible = seen
      if (!seen) return
      const on = beat.lamps
      lamp.intensity = 2 + 13 * on
      shadeMaterial.color.setRGB(1, 0.82, 0.6).multiplyScalar(0.6 + 3.2 * on)
      glow.color.copy(screenTint)
      glow.intensity = 0.5 + 1.1 * on
      person.group.visible = person.ready
      if (person.byName && person.frame) {
        person.uniforms.uLight.value.setRGB(0, 0, 0)
        // Facing the desk, which is to say away from the street.
        person.place(seatX, seatZ - 0.02, -Math.PI / 2, FLOOR)
        applyPose(person.byName, deskPose(pose, beat.t), person.frame)
      }
    },
    dispose() {
      for (const dispose of disposers) dispose()
    },
  }
}
