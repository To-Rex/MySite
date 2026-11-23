// Shared helpers for the model configs.

/**
 * Lamps, where a model has them painted into one texture: inside the boxes
 * the config gives (in the normalised car's metres, either side), by colour.
 * boxes: { front: [x0, x1, y0, y1, z0, z1], rear: [...] } with |z| between z0 and z1.
 */
export const lamp = (ctx, boxes) => {
  const { centre, normal, hsv } = ctx
  const [h, s, v] = hsv
  const inside = (b) => b && centre[0] > b[0] && centre[0] < b[1] && centre[1] > b[2] && centre[1] < b[3] && Math.abs(centre[2]) > b[4] && Math.abs(centre[2]) < b[5]
  const amber = h > 20 && h < 52 && s > 0.4 && v > 0.4
  const red = (h > 330 || h < 16) && s > 0.35 && v > 0.18
  if (inside(boxes.front) && normal[0] > 0.2) return amber ? 'lamp_turn' : v > 0.35 ? 'lamp_front' : null
  if (inside(boxes.frontTurn) && normal[0] > -0.2 && amber) return 'lamp_turn'
  if (inside(boxes.rear) && normal[0] < -0.2) return amber ? 'lamp_turn' : red ? 'lamp_rear' : v > 0.5 && s < 0.25 ? 'lamp_rear' : null
  return null
}


/** A soft 0–1 window: 1 between a and b, falling to 0 over 'soft' outside them. */
export const band = (x, a, b, soft) => Math.min(1, Math.max(0, (x - a + soft) / soft)) * Math.min(1, Math.max(0, (b - x + soft) / soft))
