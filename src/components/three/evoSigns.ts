import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'

/**
 * The signs over the shops, drawn once into one picture.
 *
 * No image files, like everything else here: a canvas, the page's own type,
 * and the words a street in Tashkent has over its doors — bread, tea, books,
 * a pharmacy — in Uzbek, as they are written there. They are the kinds of
 * shop there are, not anybody's shop: no names and no brands.
 */

/** [what it says, the board's colour, the lettering's colour] */
const SIGNS: readonly (readonly [string, string, string])[] = [
  ['DORIXONA', '#0f7a4a', '#f4fff6'],
  ['NON', '#f1dfb8', '#6a3d14'],
  ['OZIQ-OVQAT', '#b3261e', '#fff4e6'],
  ['CHOYXONA', '#0e5f66', '#f3e7c4'],
  ['MILLIY TAOMLAR', '#5a1420', '#e9c46a'],
  ['SOMSA', '#e07a1f', '#fff7ea'],
  ['KITOBLAR', '#14244d', '#f2efe6'],
  ['GULLAR', '#f6d7e1', '#27633b'],
  ['SARTAROSHXONA', '#18181a', '#f0f0ee'],
  ['KAFE', '#2a1c14', '#f0b14a'],
  ['OSH MARKAZI', '#1d5a34', '#f0d27a'],
  ['SHIRINLIKLAR', '#8a2f55', '#ffe9f1'],
  ['KIYIMLAR', '#efefec', '#1b1b1d'],
  ['MEVA-SABZAVOT', '#2f7a2c', '#fff9d6'],
  ['ZARGARLIK', '#101012', '#d9b55a'],
  ['TELEFONLAR', '#1553a8', '#ffffff'],
  ['GOʻSHT', '#8f1d1d', '#fff1e8'],
  ['SUT MAHSULOTLARI', '#e9f1fb', '#1c4f9a'],
  ['OPTIKA', '#0c3b5a', '#e6f6ff'],
  ['POYABZAL', '#3a2a20', '#f2e2c8'],
  ['ATIRLAR', '#2c1838', '#f1c9ee'],
  ['MATBUOT', '#d6c9a8', '#2a2622'],
  ['GAZAKLAR', '#b8431b', '#fff3df'],
  ['QANDOLATXONA', '#f4e3d0', '#7a3b2a'],
  ['OʻYINCHOQLAR', '#f2c230', '#22306e'],
  ['XOʻJALIK MOLLARI', '#3f4a52', '#eef2f4'],
  ['TIKUVCHILIK', '#6b2d5c', '#fbe9f6'],
  ['MUZQAYMOQ', '#bfe6f2', '#19506a'],
  ['SOVGʻALAR', '#7a1d2e', '#ffe2a8'],
  ['SOATLAR', '#16181c', '#cfd6de'],
  ['SHARBATLAR', '#f08a24', '#fffbe9'],
  ['NONVOYXONA', '#7a4a1e', '#fbe6bf'],
]

/** How the picture is divided: so many signs across, so many down. */
export const SIGN_GRID = { columns: 4, rows: 8 } as const
const CELL = { width: 512, height: 80 } as const

export function drawSigns(canvas: HTMLCanvasElement): void {
  canvas.width = CELL.width * SIGN_GRID.columns
  canvas.height = CELL.height * SIGN_GRID.rows
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  SIGNS.forEach(([text, board, ink], index) => {
    const x = (index % SIGN_GRID.columns) * CELL.width
    const y = Math.floor(index / SIGN_GRID.columns) * CELL.height
    ctx.fillStyle = board
    ctx.fillRect(x, y, CELL.width, CELL.height)
    // A line round it, a little in from the edge, as a board has.
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 2
    ctx.strokeRect(x + 7, y + 7, CELL.width - 14, CELL.height - 14)
    ctx.globalAlpha = 1
    ctx.fillStyle = ink
    // As large as fits: a long word is set smaller, not squeezed.
    let size = 50
    do {
      ctx.font = `800 ${size}px Manrope, "Manrope Variable", system-ui, sans-serif`
      size -= 2
    } while (size > 18 && ctx.measureText(text).width > CELL.width - 56)
    ctx.fillText(text, x + CELL.width / 2, y + CELL.height / 2 + 2)
  })
}

/** The signs as a texture, the first row of the picture at the top. */
export function makeSigns(): CanvasTexture {
  const canvas = document.createElement('canvas')
  drawSigns(canvas)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  return texture
}

/** What the shops are, for a test to read: every one of them a kind of shop and not a name. */
export const SIGN_WORDS: readonly string[] = SIGNS.map(([text]) => text)
