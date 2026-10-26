import type { MessageKey } from '@/i18n'
import type { Point } from '@/web/scene/types'
import { paintLabel } from '@/web/scene/render2d/street/label'
import { shadeOf } from '@/web/scene/render2d/street/park-props'
import { tr } from '@/web/text/tr'

const TONES = Object.freeze({
  shadow: 'rgba(0,0,0,.15)',
  cart: '#8E9AA3',
  cartTop: '#B9C2C9',
  wheel: '#171B26',
  pot: '#D5D8DE',
  potKnob: '#8A93A6',
  potSmall: '#C4C8D0',
  board: '#F2EFE6',
  noodles: '#E8C94A',
  pole: '#8A6B3E',
  phoSign: '#D8453B',
  warmer: '#DCE6EA',
  warmerLit: '#FFE6A8',
  warmerRail: '#8A93A6',
  lateSign: '#2E3A34',
  lateInk: '#FFE6A8',
  bulb: '#FFD070',
  bulbGlow: '255,208,112',
  cooler: '#3F7FC5',
  coolerLid: '#F2EFE6',
  crate: '#E8C94A',
  breadCart: '#9B7A52',
  breadTop: '#C9A878',
  breadWheel: '#171B26',
  glassCase: '#F2F0EA',
  baguette: '#E8C94A',
  parasol: ['#D8514B', '#F2EFE6'],
  parasolRim: '#D8514B',
  signInk: '#FFFFFF',
  breadInk: '#F8E7C4',
})
// The cook or seller standing behind a cart, as the mockup draws a vendor: white shirt and cap,
// an apron close up.
const VENDOR = Object.freeze({
  shadow: 'rgba(0,0,0,.16)',
  pants: '#3B4458',
  shirt: '#F2F0EA',
  cap: '#F2EFE6',
  apron: '#E8E2D4',
  shoe: '#1F2230',
  eye: '#2B2433',
})
const LIT_FROM = 0.25
const WORD_PX = 1

/** What a cart is painted on: the canvas, how dark it is and the detail level. */
export interface CartScene {
  readonly g: CanvasRenderingContext2D
  readonly dark: number
  readonly detail: number
}

/** The phở cart: the cook, a steel cart with the broth pot and a small pot, the board and the
 *  noodles close up, the red sign on its pole. */
export function paintPhoCart(scene: CartScene, at: Point & { readonly skin: string }): void {
  const { g } = scene
  const { x, y } = at
  const tone = (hex: string): string => shadeOf(scene, hex)

  paintCartBase(scene, { x, y, skin: at.skin })
  g.fillStyle = tone(TONES.pot)
  g.fillRect(x - 2.4, y - 4.5, 3, 1.6)
  oval(g, [x - 0.9, y - 4.5, 1.7, 0.45])
  g.fillStyle = tone(TONES.potKnob)
  g.fillRect(x - 1.1, y - 5.1, 0.4, 0.5)
  g.fillStyle = tone(TONES.potSmall)
  g.fillRect(x + 0.9, y - 4, 1.9, 1.1)
  oval(g, [x + 1.85, y - 4, 1.05, 0.3])
  g.fillStyle = tone(TONES.pole)
  g.fillRect(x - 3.4, y - 6.6, 0.3, 6.6)
  g.fillStyle = tone(TONES.phoSign)
  g.fillRect(x - 3.7, y - 7.6, 3.4, 1.4)
  paintCartWord(scene, {
    key: 'ui.office.street.vendor.pho',
    x: x - 2,
    y: y - 6.9,
    maxW: 3.2,
    ink: TONES.signInk,
  })

  if (scene.detail > 0) {
    g.fillStyle = tone(TONES.board)
    g.fillRect(x + 0.3, y - 2.2, 2.4, 0.9)
    g.fillStyle = tone(TONES.noodles)
    g.fillRect(x - 2.6, y - 2.2, 1.4, 0.9)
  }
}

/** The late noodle cart: the cook, the steel cart, a glass warmer lit after dusk, the pot, the
 *  frame with its dark sign and a hanging bulb that throws a warm light. */
export function paintLateCart(scene: CartScene, at: Point & { readonly skin: string }): void {
  const { g, dark } = scene
  const { x, y } = at
  const tone = (hex: string): string => shadeOf(scene, hex)

  paintCartBase(scene, { x, y, skin: at.skin })
  g.fillStyle = dark > LIT_FROM ? TONES.warmerLit : tone(TONES.warmer)
  g.fillRect(x + 0.7, y - 5.2, 2.6, 2.2)
  g.fillStyle = tone(TONES.warmerRail)
  g.fillRect(x + 0.5, y - 5.4, 3, 0.3)
  g.fillRect(x + 0.5, y - 3.1, 3, 0.3)
  g.fillStyle = tone(TONES.pot)
  g.fillRect(x - 2.6, y - 4.4, 2.6, 1.5)
  oval(g, [x - 1.3, y - 4.4, 1.5, 0.4])
  g.fillStyle = tone(TONES.pole)
  g.fillRect(x - 3.5, y - 7.4, 0.3, 7.4)
  g.fillRect(x - 3.5, y - 7.4, 7, 0.28)
  g.fillStyle = tone(TONES.lateSign)
  g.fillRect(x - 1.8, y - 7.1, 3.6, 1.2)
  paintCartWord(scene, {
    key: 'ui.office.street.vendor.late',
    x,
    y: y - 6.5,
    maxW: 3.4,
    ink: TONES.lateInk,
  })
  g.fillStyle = TONES.bulb
  g.beginPath()
  g.arc(x + 3, y - 7.1, 0.55, 0, Math.PI * 2)
  g.fill()

  if (dark > LIT_FROM) {
    const glow = g.createRadialGradient(x + 3, y - 7, 0, x + 3, y - 7, 6)

    glow.addColorStop(0, `rgba(${TONES.bulbGlow},.55)`)
    glow.addColorStop(1, `rgba(${TONES.bulbGlow},0)`)
    g.fillStyle = glow
    g.fillRect(x - 3, y - 13, 12, 12)
  }
}

/** A cooler box with its lid, and a crate of drinks beside it. */
export function paintCooler(
  scene: CartScene,
  at: Point & { readonly tone: string; readonly hasCrate: boolean }
): void {
  const { g } = scene
  const { x, y } = at

  g.fillStyle = TONES.shadow
  oval(g, [x, y + 0.2, 3, 0.7])
  g.fillStyle = shadeOf(scene, at.tone)
  g.fillRect(x - 2.2, y - 2.2, 4.4, 2.2)
  g.fillStyle = shadeOf(scene, TONES.coolerLid)
  g.fillRect(x - 2.4, y - 2.6, 4.8, 0.5)

  if (at.hasCrate) {
    g.fillStyle = shadeOf(scene, TONES.crate)
    g.fillRect(x + 2.6, y - 1.5, 1.8, 1.5)
    g.fillRect(x + 2.6, y - 2.4, 1.8, 0.8)
  }
}

/** The bánh mì cart: the seller, the wooden cart with its glass case and loaves close up, wheels,
 *  the striped parasol with its rim, the word on the cart close up. */
export function paintBanhMiCart(scene: CartScene, at: Point & { readonly skin: string }): void {
  const { g } = scene
  const { x, y } = at
  const tone = (hex: string): string => shadeOf(scene, hex)

  g.fillStyle = 'rgba(0,0,0,.16)'
  g.fillRect(x - 4.8, y, 9.6, 2.4)
  paintVendor(scene, { x, y, skin: at.skin })
  g.fillStyle = tone(TONES.breadCart)
  g.fillRect(x - 4, y - 3, 8, 2.8)
  g.fillStyle = tone(TONES.breadTop)
  g.fillRect(x - 4, y - 3.4, 8, 0.8)
  g.fillStyle = tone(TONES.breadWheel)
  g.beginPath()
  g.arc(x - 2.8, y + 0.1, 0.8, 0, Math.PI * 2)
  g.arc(x + 2.8, y + 0.1, 0.8, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = tone(TONES.pole)
  g.fillRect(x - 0.1, y - 8.2, 0.3, 5)

  for (let index = 0; index < 6; index++) {
    g.fillStyle = tone(TONES.parasol[index % 2] ?? TONES.glassCase)
    g.beginPath()
    g.moveTo(x + 0.05, y - 8.2)
    g.lineTo(x - 5 + index * 1.667, y - 5.8)
    g.lineTo(x - 5 + (index + 1) * 1.667, y - 5.8)
    g.closePath()
    g.fill()
  }

  g.fillStyle = tone(TONES.parasolRim)
  g.fillRect(x - 5, y - 5.9, 10, 0.35)

  if (scene.detail > 0) {
    g.fillStyle = tone(TONES.glassCase)
    g.fillRect(x - 1.5, y - 3.4, 3, 0.7)
    g.fillStyle = tone(TONES.baguette)
    g.fillRect(x - 3.4, y - 3.9, 1.2, 0.5)
  }

  paintCartWord(scene, {
    key: 'ui.office.street.vendor.banhMi',
    x,
    y: y - 1.4,
    maxW: 7,
    ink: TONES.breadInk,
  })
}

// A steel cart's shadow, the cook standing behind it, its body, top and two wheels.
function paintCartBase(scene: CartScene, at: Point & { readonly skin: string }): void {
  const { g } = scene
  const { x, y } = at

  g.fillStyle = TONES.shadow
  oval(g, [x, y + 0.2, 3.8, 0.8])
  paintVendor(scene, { x: x + 0.4, y: y - 1, skin: at.skin })
  g.fillStyle = shadeOf(scene, TONES.cart)
  g.fillRect(x - 3.2, y - 2.6, 6.4, 2.6)
  g.fillStyle = shadeOf(scene, TONES.cartTop)
  g.fillRect(x - 3.2, y - 2.9, 6.4, 0.4)
  g.fillStyle = shadeOf(scene, TONES.wheel)
  g.beginPath()
  g.arc(x - 2.2, y + 0.1, 0.7, 0, Math.PI * 2)
  g.arc(x + 2.2, y + 0.1, 0.7, 0, Math.PI * 2)
  g.fill()
}

/** A vendor facing the street: legs, white shirt, head and white cap, shoes and an apron close
 *  up, eyes closest. */
export function paintVendor(scene: CartScene, at: Point & { readonly skin: string }): void {
  const { g } = scene
  const { x, y } = at
  const tone = (hex: string): string => shadeOf(scene, hex)

  g.fillStyle = VENDOR.shadow
  oval(g, [x, y, 1.5, 0.55])
  g.fillStyle = tone(VENDOR.pants)
  g.fillRect(x - 0.75, y - 1.8, 0.65, 1.8)
  g.fillRect(x + 0.1, y - 1.8, 0.65, 1.8)
  g.fillStyle = tone(VENDOR.shirt)
  g.fillRect(x - 0.95, y - 3.3, 1.9, 1.6)
  g.fillStyle = tone(at.skin)
  g.beginPath()
  g.arc(x, y - 4, 0.85, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = tone(VENDOR.cap)
  g.fillRect(x - 0.9, y - 4.9, 1.8, 0.7)

  if (scene.detail > 0) {
    g.fillStyle = tone(VENDOR.shoe)
    g.fillRect(x - 0.8, y - 0.25, 0.7, 0.25)
    g.fillRect(x + 0.1, y - 0.25, 0.7, 0.25)
  }

  if (scene.detail === 2) {
    g.fillStyle = tone(VENDOR.apron)
    g.fillRect(x - 0.85, y - 2.7, 1.7, 1.1)
    g.fillStyle = tone(VENDOR.eye)
    g.fillRect(x - 0.45, y - 4.05, 0.22, 0.22)
    g.fillRect(x + 0.25, y - 4.05, 0.22, 0.22)
  }
}

/** A stall's word in its ink, close up only. */
export function paintCartWord(
  scene: CartScene,
  word: {
    readonly key: MessageKey
    readonly x: number
    readonly y: number
    readonly maxW: number
    readonly ink: string
  }
): void {
  if (scene.detail === 2) {
    paintLabel(scene.g, tr(word.key), {
      x: word.x,
      y: word.y,
      size: WORD_PX,
      colour: word.ink,
      maxW: word.maxW,
    })
  }
}

function oval(g: CanvasRenderingContext2D, at: readonly [number, number, number, number]): void {
  g.beginPath()
  g.ellipse(at[0], at[1], at[2], at[3], 0, 0, Math.PI * 2)
  g.fill()
}
