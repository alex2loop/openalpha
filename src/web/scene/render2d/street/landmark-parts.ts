import {
  DESIGN,
  halfWidthAt,
  hazeTone,
  ROOF_Y,
  TIP_Y,
  type TowerPaint,
} from '@/web/scene/render2d/street/landmark-shape'

const TAU = Math.PI * 2
const DECK = Object.freeze({ rx: 34, ry: 7.2, shift: 12 })
const AVIATION_RED = '#FF5A4D'
const LAMP_WHITE = '#FFF1CC'
const DECK_LAMPS = 22
const RED_EVERY = 7
const NIGHT_ALPHA_GAIN = 1.2
const NIGHT_GLOW = Object.freeze({ spire: 'rgba(176,206,255,', deck: 'rgba(255,226,170,' })

/** The tower's podium at its foot: louvred silver walls under a rounded canopy lip, the glass
 *  shopfront with its door, the curved panel beside the steel drum, and the drum. Its rented
 *  screen is not here: it hangs on the frontage building. */
export function paintPodium(t: TowerPaint): void {
  const px = -DESIGN.podiumW / 2 - DESIGN.podiumPad
  const pw = DESIGN.podiumW + 2 * DESIGN.podiumPad

  paintPodiumWall(t, { x: px, w: pw })
  paintPodiumPanel(t)
  paintShopfront(t, { x: px, w: pw })
  paintCanopyLip(t, { x: px, w: pw })
  paintDrum(t)
}

// The wall: a silver gradient with fine floor lines and mullions, shaded at both ends.
function paintPodiumWall(t: TowerPaint, at: { readonly x: number; readonly w: number }): void {
  const { g } = t
  const bottom = 0
  const fill = g.createLinearGradient(0, ROOF_Y, 0, bottom)

  fill.addColorStop(0, hazeTone(t, '#C6CED8', 0.5))
  fill.addColorStop(0.55, hazeTone(t, '#9DAAB9', 0.55))
  fill.addColorStop(1, hazeTone(t, '#7E8A99', 0.58))
  g.fillStyle = fill
  g.fillRect(at.x, ROOF_Y, at.w, DESIGN.podium)
  g.fillStyle = hazeTone(t, '#5F6D80', 0.55)
  g.globalAlpha = 0.3

  for (let y = ROOF_Y + 4; y < bottom - DESIGN.glassH; y += 4) {
    g.fillRect(at.x, y, at.w, 0.45)
  }

  for (let row = 0, y = ROOF_Y + 2; y < bottom - DESIGN.glassH; y += 4, row++) {
    for (let x = at.x + 14 + (row % 2) * 6; x < at.x + at.w; x += 12) {
      g.fillRect(x, y, 0.45, 4)
    }
  }

  g.globalAlpha = 1

  const ends = g.createLinearGradient(at.x, 0, at.x + at.w, 0)

  ends.addColorStop(0, 'rgba(20,30,46,.3)')
  ends.addColorStop(0.07, 'rgba(20,30,46,0)')
  ends.addColorStop(0.93, 'rgba(20,30,46,0)')
  ends.addColorStop(1, 'rgba(20,30,46,.3)')
  g.fillStyle = ends
  g.fillRect(at.x, ROOF_Y, at.w, DESIGN.podium)
}

// The curved base beside the drum: a convex silver panel.
function paintPodiumPanel(t: TowerPaint): void {
  const { g } = t
  const left = DESIGN.drum.x + DESIGN.drum.w - 1
  const width = DESIGN.panelRight - left
  const fill = g.createLinearGradient(left, 0, left + width, 0)

  fill.addColorStop(0, hazeTone(t, '#7F8C9B', 0.6))
  fill.addColorStop(0.35, hazeTone(t, '#E6ECF2', 0.52))
  fill.addColorStop(0.7, hazeTone(t, '#AEB9C5', 0.56))
  fill.addColorStop(1, hazeTone(t, '#6E7B8B', 0.6))
  g.fillStyle = fill
  g.fillRect(left, ROOF_Y + 1, width, -DESIGN.glassH - ROOF_Y - 1)
}

// The glass shopfront at the foot, lit warm after dusk, and the door at the centre.
function paintShopfront(t: TowerPaint, at: { readonly x: number; readonly w: number }): void {
  const { g } = t
  const top = -DESIGN.glassH
  const fill = g.createLinearGradient(0, top, 0, 0)

  if (t.isLobbyLit) {
    fill.addColorStop(0, '#FFF0C4')
    fill.addColorStop(1, '#FFD98A')
  } else {
    fill.addColorStop(0, hazeTone(t, '#C3D8E6', 0.6))
    fill.addColorStop(1, hazeTone(t, '#7F9DB2', 0.6))
  }

  g.fillStyle = fill
  g.fillRect(at.x, top, at.w, DESIGN.glassH)
  g.fillStyle = t.isLobbyLit ? 'rgba(110,80,40,.5)' : hazeTone(t, '#566A80', 0.55)

  for (let x = at.x + DESIGN.drum.w + 2; x < at.x + at.w; x += 5.5) {
    g.fillRect(x, top, 0.6, DESIGN.glassH)
  }

  g.fillStyle = hazeTone(t, '#D5DCE5', 0.5)
  g.fillRect(at.x, top - 0.4, at.w, 1.1)
  g.fillStyle = hazeTone(t, '#56637A', 0.6)
  g.fillRect(at.x, -0.9, at.w, 0.9)
  g.fillStyle = hazeTone(t, '#D8DCE8', 0.5)
  g.fillRect(-9, top + 1.2, 18, DESIGN.glassH - 1.2)
  g.fillStyle = t.isLobbyLit ? '#FFF3CE' : hazeTone(t, '#9FB6C8', 0.6)
  g.fillRect(-8, top + 2, 16, DESIGN.glassH - 2)
}

// A rounded silver edge along the roof, thicker at the ends.
function paintCanopyLip(t: TowerPaint, at: { readonly x: number; readonly w: number }): void {
  const { g } = t
  const fill = g.createLinearGradient(0, ROOF_Y - 2.4, 0, ROOF_Y + 1.8)

  fill.addColorStop(0, hazeTone(t, '#F2F5F8', 0.5))
  fill.addColorStop(0.5, hazeTone(t, '#C4CCD6', 0.52))
  fill.addColorStop(1, hazeTone(t, '#8C97A6', 0.56))
  g.fillStyle = fill
  g.beginPath()
  g.roundRect(at.x - 1.6, ROOF_Y - 2.4, at.w + 3.2, 4.2, 2)
  g.fill()
  g.fillStyle = 'rgba(30,40,56,.28)'
  g.fillRect(at.x, ROOF_Y + 1.8, at.w, 1.2)
}

// The steel drum at the corner: ring seams and a rounded canopy on top, lit at its foot at night.
function paintDrum(t: TowerPaint): void {
  const { g } = t
  const { x, w, h } = DESIGN.drum
  const top = -h
  const fill = g.createLinearGradient(x, 0, x + w, 0)

  fill.addColorStop(0, hazeTone(t, '#6C7783', 0.6))
  fill.addColorStop(0.22, hazeTone(t, '#EEF2F6', 0.55))
  fill.addColorStop(0.45, hazeTone(t, '#B8C1CB', 0.6))
  fill.addColorStop(0.8, hazeTone(t, '#7E8995', 0.62))
  fill.addColorStop(1, hazeTone(t, '#505B67', 0.65))
  g.fillStyle = fill
  g.fillRect(x, top, w, h)
  g.fillStyle = 'rgba(40,50,62,.2)'

  for (let y = top + 4; y < -2; y += 3.4) {
    g.fillRect(x, y, w, 0.5)
  }

  if (t.isLobbyLit) {
    const glow = g.createLinearGradient(0, -12, 0, 0)

    glow.addColorStop(0, 'rgba(255,214,140,0)')
    glow.addColorStop(1, 'rgba(255,214,140,.5)')
    g.fillStyle = glow
    g.fillRect(x, -12, w, 12)
  }

  g.fillStyle = hazeTone(t, '#E6ECF2', 0.55)
  g.beginPath()
  g.ellipse(x + w / 2, top, w / 2 + 2.2, 3.2, 0, 0, TAU)
  g.fill()
  g.strokeStyle = hazeTone(t, '#8D98A6', 0.58)
  g.lineWidth = 1.1
  g.beginPath()
  g.ellipse(x + w / 2, top + 0.4, w / 2 + 1.6, 2.8, 0, 0.05 * Math.PI, 0.95 * Math.PI)
  g.stroke()
  g.fillStyle = hazeTone(t, '#BCC5CF', 0.56)
  g.beginPath()
  g.ellipse(x + w / 2, top - 0.3, w / 2 - 1.2, 1.9, 0, 0, TAU)
  g.fill()
}

/** The tower's crown: the spire's mast and the helipad deck that leaves the shaft on a slim steel
 *  neck at floor 52 of 68, with a flag mast on it; after dusk the spire and the deck rim are lit,
 *  with red aviation lights at the tip and the deck. */
export function paintCrown(t: TowerPaint): void {
  const { g } = t
  const yh = DESIGN.helipadY
  const edge = halfWidthAt(yh)
  const centre = edge + DECK.rx - DECK.shift

  g.strokeStyle = hazeTone(t, '#C9D2DC', 0.5)
  g.lineWidth = 0.9
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(0, TIP_Y + 1)
  g.lineTo(0, -DESIGN.height)
  g.stroke()
  paintNeck(t, { edge, yh })
  paintDeck(t, { centre, yh })

  if (t.isNight) {
    paintCrownLights(t, { centre, yh })
  }
}

// The deck's shadow on the facade, and the slim steel neck it leaves the shaft on.
function paintNeck(t: TowerPaint, at: { readonly edge: number; readonly yh: number }): void {
  const { g } = t
  const { edge: ed, yh } = at

  g.save()
  g.beginPath()
  g.rect(ed - 16, yh, 16, 24)
  g.clip()
  g.translate(ed - 4, yh + 9)
  g.scale(1, 0.34)

  const shadow = g.createRadialGradient(0, 0, 1, 0, 0, 13)

  shadow.addColorStop(0, 'rgba(8,16,32,.5)')
  shadow.addColorStop(1, 'rgba(8,16,32,0)')
  g.fillStyle = shadow
  g.fillRect(-14, -14, 28, 28)
  g.restore()

  const steel = g.createLinearGradient(ed - 6, 0, ed + 13, 0)

  steel.addColorStop(0, hazeTone(t, '#6A7484', 0.6))
  steel.addColorStop(0.5, hazeTone(t, '#8C96A4', 0.58))
  steel.addColorStop(1, hazeTone(t, '#4C5462', 0.62))
  g.fillStyle = steel
  g.beginPath()
  g.moveTo(ed - 6, yh + 6)
  g.lineTo(ed + 13, yh + 6)
  g.quadraticCurveTo(ed + 9, yh + 9.6, ed + 6, yh + 11.6)
  g.lineTo(ed - 2, yh + 11.6)
  g.quadraticCurveTo(ed - 4, yh + 9, ed - 6, yh + 6)
  g.fill()
  g.strokeStyle = hazeTone(t, '#D2D9E2', 0.5)
  g.lineWidth = 0.5
  g.beginPath()
  g.moveTo(ed - 2, yh + 11.8)
  g.lineTo(ed + 6, yh + 11.8)
  g.stroke()
}

// The deck slab: a dark underside bowl, a thick pale edge, a railing ring on top, a flag mast.
function paintDeck(t: TowerPaint, at: { readonly centre: number; readonly yh: number }): void {
  const { g } = t
  const { centre: c, yh } = at
  const { rx, ry } = DECK
  const bowl = g.createLinearGradient(c - rx, 0, c + rx, 0)

  bowl.addColorStop(0, hazeTone(t, '#3A4250', 0.6))
  bowl.addColorStop(0.45, hazeTone(t, '#5A6372', 0.58))
  bowl.addColorStop(0.8, hazeTone(t, '#7B8595', 0.58))
  bowl.addColorStop(1, hazeTone(t, '#9AA4B2', 0.58))
  g.fillStyle = hazeTone(t, '#8C96A4', 0.58)
  g.beginPath()
  g.ellipse(c, yh + 3.4, rx, ry, 0, 0, TAU)
  g.fill()
  g.fillStyle = bowl
  g.beginPath()
  g.ellipse(c, yh + 1.6, rx - 0.6, ry - 0.4, 0, 0, TAU)
  g.fill()
  g.fillStyle = hazeTone(t, '#C4CCD6', 0.5)
  g.beginPath()
  g.ellipse(c, yh - 0.6, rx, ry - 0.2, 0, Math.PI * 1.02, Math.PI * 1.98)
  g.ellipse(c, yh + 0.3, rx - 0.8, ry - 1, 0, Math.PI * 1.98, Math.PI * 1.02, true)
  g.fill()
  g.strokeStyle = hazeTone(t, '#E8EDF2', 0.5)
  g.lineWidth = 0.9
  g.beginPath()
  g.ellipse(c, yh - 1.3, rx - 0.2, ry - 0.6, 0, Math.PI * 1.03, Math.PI * 1.97)
  g.stroke()
  g.strokeStyle = hazeTone(t, '#B7C0CB', 0.5)
  g.lineWidth = 0.6
  g.beginPath()
  g.moveTo(c + rx * 0.38, yh - 3)
  g.lineTo(c + rx * 0.38, yh - 13)
  g.stroke()
}

// After dusk: a glow round the spire and the deck, then the deck rim in lamps and the red aviation
// lights.
function paintCrownLights(
  t: TowerPaint,
  at: { readonly centre: number; readonly yh: number }
): void {
  const { g } = t
  const { centre: c, yh } = at
  const alpha = Math.min(1, t.dark * NIGHT_ALPHA_GAIN)
  const spire = g.createRadialGradient(0, TIP_Y + 6, 1, 0, TIP_Y + 6, 46)

  spire.addColorStop(0, `${NIGHT_GLOW.spire}${0.34 * alpha})`)
  spire.addColorStop(1, `${NIGHT_GLOW.spire}0)`)
  g.fillStyle = spire
  g.fillRect(-50, TIP_Y - 44, 100, 100)

  g.save()
  g.translate(0, yh + 4)
  g.scale(1, 0.38)
  g.translate(0, -yh - 4)

  const deck = g.createRadialGradient(c, yh + 4, 2, c, yh + 4, 48)

  deck.addColorStop(0, `${NIGHT_GLOW.deck}${0.22 * alpha})`)
  deck.addColorStop(1, `${NIGHT_GLOW.deck}0)`)
  g.fillStyle = deck
  g.fillRect(c - 50, yh - 44, 100, 100)
  g.restore()
  g.globalAlpha = alpha
  paintDeckLamps(t, at)
  g.globalAlpha = 1
}

// The deck rim in lamps with a red one every seventh, and red lights at the spire's tip and the
// flag mast.
function paintDeckLamps(t: TowerPaint, at: { readonly centre: number; readonly yh: number }): void {
  const { g } = t
  const { centre: c, yh } = at
  const { rx, ry } = DECK

  for (let i = 0; i < DECK_LAMPS; i++) {
    const u = Math.PI * (1.03 + (0.94 * i) / (DECK_LAMPS - 1))
    const isRed = i % RED_EVERY === 0

    g.fillStyle = isRed ? AVIATION_RED : LAMP_WHITE
    g.beginPath()
    g.arc(
      c + Math.cos(u) * (rx - 0.2),
      yh - 1.3 + Math.sin(u) * (ry - 0.6),
      isRed ? 0.9 : 0.65,
      0,
      TAU
    )
    g.fill()
  }

  g.fillStyle = AVIATION_RED

  for (const [x, y, r] of [
    [0, -DESIGN.height - 0.2, 0.9],
    [c + rx * 0.38, yh - 13.5, 0.7],
  ] as const) {
    g.beginPath()
    g.arc(x, y, r, 0, TAU)
    g.fill()
  }
}
