import type { PaintScene } from '@/web/scene/render2d/wall-props'
import type { PropDef } from '@/web/scene/world/props'
import { castShadow, fill, INK } from '@/web/scene/render2d/building'
import { METAL, PROP_TONES } from '@/web/scene/sprites/palette'
import { HEIGHT_K } from '@/web/scene/view'

const BANKER_LAMP = 1
const TRAY_HANGER_STEP = 22
const LAMP_TONES = Object.freeze({
  bankerOn: ['#D9B25C', '#9CFFC0', '#E6FFF0'],
  bankerOff: ['#D9B25C', '#5FA878', '#8CCB98'],
  deskOn: '#FFE9A8',
  tray: ['#B9C0CC', '#AAB1BD'],
  shadeRimOn: '#FFFFFF',
  shadeRimOff: '#F6EFDD',
} as const)
// The mockup's floor lamp in world px: the shade's width, height and how high its middle hangs,
// and the pole's height; 2D foreshortens heights by the camera's angle.
const FLOOR_LAMP = Object.freeze({ shadeW: 12.8, shadeH: 8.8, shadeY: 52, poleH: 48 })
const LAMP_SHADE_FRONT = '#CFC4A8'
const LAMP_LIT_FRONT = '#F2D58B'

// The room's floor lamp as the mockup draws it, from the same look as 3D: a dark base, a thin pole
// and a box shade seen from above (its top face, then its front), lit exactly while its switch is on.
export function paintLamp(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw
  const cx = x + w / 2
  const z = y + h
  const isOn = scene.lit.has(prop.room)
  const shade = Math.round(FLOOR_LAMP.shadeW)
  const half = shade >> 1
  const front = Math.round(FLOOR_LAMP.shadeH * HEIGHT_K)
  const pole = Math.round(FLOOR_LAMP.poleH * HEIGHT_K)
  const top = Math.round(z - (FLOOR_LAMP.shadeY + FLOOR_LAMP.shadeH / 2) * HEIGHT_K - shade / 2)

  castShadow(g, [cx - 6, z - 1, 12, 3])
  fill(g, [cx - 5, z - 3, 10, 3], INK)
  fill(g, [cx - 4, z - 3, 8, 2], METAL[2])
  fill(g, [cx - 2, z - 3 - pole, 4, pole], INK)
  fill(g, [cx - 1, z - 3 - pole, 2, pole], METAL[2])
  fill(g, [cx - half - 1, top - 1, shade + 2, shade + front + 2], INK)
  fill(g, [cx - half, top, shade, shade], isOn ? PROP_TONES.lampLit : PROP_TONES.lampOff)
  fill(g, [cx - half, top + shade, shade, front], isOn ? LAMP_LIT_FRONT : LAMP_SHADE_FRONT)
  fill(g, [cx - half, top, shade, 1], isOn ? LAMP_TONES.shadeRimOn : LAMP_TONES.shadeRimOff)
}

// A desk lamp lit exactly while its room's switch is on: your angled lamp, or the library's green
// banker's lamp.
export function paintDeskLamp(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y } = prop.draw
  const isOn = scene.lit.has(prop.room)

  if (prop.variant === BANKER_LAMP) {
    const [brass, shade, rim] = isOn ? LAMP_TONES.bankerOn : LAMP_TONES.bankerOff

    fill(g, [x + 2, y + 9, 6, 3], brass)
    fill(g, [x + 4, y + 4, 1, 6], brass)
    fill(g, [x, y, 10, 5], INK)
    fill(g, [x + 1, y + 1, 8, 3], shade)
    fill(g, [x + 1, y + 1, 8, 1], rim)
    return
  }

  fill(g, [x, y + 12, 6, 2], METAL[2])
  fill(g, [x + 2, y + 3, 1, 9], METAL[2])
  fill(g, [x + 2, y + 3, 7, 1], METAL[2])
  fill(g, [x + 5, y, 9, 5], INK)
  fill(g, [x + 6, y + 1, 7, 3], isOn ? LAMP_TONES.deskOn : PROP_TONES.lampOff)
}

// A cable tray across the store's ceiling with a hanger every few steps.
export function paintCableTray(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w } = prop.draw

  fill(g, [x, y, w, 2], LAMP_TONES.tray[0])
  fill(g, [x, y + 2, w, 1], METAL[2])

  for (let i = 0; i < w; i += TRAY_HANGER_STEP) {
    fill(g, [x + i, y + 2, 1, 3], LAMP_TONES.tray[1])
  }
}
