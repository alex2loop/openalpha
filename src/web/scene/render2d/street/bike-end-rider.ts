import {
  type Cm,
  type EndArt,
  quad,
  seg,
  spot,
  toPx,
} from '@/web/scene/render2d/street/bike-end-pen'
import {
  BIKE_TONES,
  CM_ALONG,
  type HelmetStyle,
  LIGHT,
  SHADE,
  shade,
} from '@/web/scene/render2d/street/bike-model'
import { mixTone } from '@/web/scene/render2d/street/tone'

const VISOR = Object.freeze({ full: { up: 2, half: 12, h: 7 }, clear: { up: 1, half: 13, h: 13 } })

export function paintPillion(art: EndArt): void {
  const pillion = art.look.pillion

  if (pillion === undefined) {
    return
  }

  const jacket = art.tone(pillion.jacket)
  const sleeve = shade(art, pillion.jacket)
  const z = art.dir > 0 ? 7 : 0

  if (pillion.isSideSaddle) {
    paintSideSaddleLegs(art, pillion.jacket)
  }

  quad(art, [-16 + z, -64, 82, 16 + z, -64, 82, 20 + z, -60, 128, -20 + z, -60, 128], jacket)
  seg(art, [-18 + z, -60, 124, -20, -20, 104], { w: 8, c: sleeve })
  seg(art, [18 + z, -60, 124, 20, -20, 104], { w: 8, c: sleeve })
  paintHelmet(art, {
    at: [z, -60, 150],
    style: pillion.isPupil ? 'half' : 'visor',
    colour: pillion.helmet,
    skin: pillion.skin,
    hair: BIKE_TONES.passengerHair,
  })
}

// A side-saddle pillion's skirt and feet hang down the near side.
function paintSideSaddleLegs(art: EndArt, jacket: string): void {
  seg(art, [24, -64, 80, 26, -60, 38], { w: 20, c: art.tone(mixTone(jacket, SHADE.to, 0.1)) })
  spot(art, [[26, -60, 34], 9, 4], art.tone(BIKE_TONES.dark))
}

export function paintTorso(art: EndArt): void {
  const { look } = art

  quad(art, [-17, -34, 80, 17, -34, 80, 22, -18, 130, -22, -18, 130], art.tone(look.jacket))

  if (look.isCoated) {
    quad(art, [-19, -34, 62, 19, -34, 62, 18, -34, 84, -18, -34, 84], shade(art, look.jacket))
  }
}

export function paintHead(art: EndArt): void {
  const { look } = art

  paintHelmet(art, {
    at: [0, -6, 152],
    style: look.helmetStyle,
    colour: look.helmet,
    skin: look.skin,
    hair: BIKE_TONES.hair,
  })
}

export function paintLegs(art: EndArt): void {
  const { look } = art
  const pants = art.tone(look.pants)
  const shoe = art.tone(BIKE_TONES.sandal)

  for (const side of [-1, 1]) {
    seg(art, [side * 14, -34, 84, side * 22, 28, 76], { w: 17, c: pants })

    if (look.isFootDown) {
      seg(art, [side * 22, 28, 76, side * 27, 32, 5], { w: 12, c: pants })
      spot(art, [[side * 27, 34, 2], 6.4, 3.4], shoe)
    } else {
      seg(art, [side * 22, 28, 76, side * 24, 20, 34], { w: 12, c: pants })
      spot(art, [[side * 24, 24, 30], 6, 3.4], shoe)
    }
  }
}

export function paintArms(art: EndArt): void {
  const { look } = art
  const hand = art.tone(look.isCoated ? BIKE_TONES.glove : look.skin)

  for (const side of [-1, 1]) {
    seg(art, [side * 22, -18, 126, side * 37, 40, 108], { w: 9.5, c: art.tone(look.jacket) })
    spot(art, [[side * 38, 40, 108], 5, 5], hand)
  }
}

// A face (or the back of the head) under the helmet's shell, its visor from the front.
function paintHelmet(
  art: EndArt,
  helmet: {
    readonly at: Cm
    readonly style: HelmetStyle
    readonly colour: string
    readonly skin: string
    readonly hair: string
  }
): void {
  const { g } = art
  const [z, f, h] = helmet.at
  const isFull = helmet.style === 'full'

  spot(art, [helmet.at, 10.5, 10.5], art.tone(art.dir > 0 ? helmet.skin : helmet.hair))

  const [x, y] = toPx(art, [z, f, h + 3])

  g.beginPath()
  g.ellipse(
    x,
    y,
    15.5 * CM_ALONG,
    (isFull ? 15.5 : 14) * CM_ALONG,
    0,
    isFull || art.dir < 0 ? 0 : Math.PI,
    Math.PI * 2
  )
  g.closePath()
  g.fillStyle = art.tone(helmet.colour)
  g.fill()

  if (art.dir > 0 && helmet.style !== 'half') {
    paintVisor(art, { at: helmet.at, isFull })
  }

  if (art.detail > 0) {
    spot(art, [[z - 3, f, h + 12], 6, 2.2], art.tone(mixTone(helmet.colour, LIGHT.to, 0.32)))
  }
}

// The visor seen from the front: a dark full-face shield or a clear one.
function paintVisor(art: EndArt, visor: { readonly at: Cm; readonly isFull: boolean }): void {
  const [z, f, h] = visor.at
  const size = visor.isFull ? VISOR.full : VISOR.clear
  const [x, y] = toPx(art, [z, f, h + size.up])

  art.g.fillStyle = visor.isFull ? BIKE_TONES.fullVisor : BIKE_TONES.visor
  art.g.fillRect(
    x - size.half * CM_ALONG,
    y - 5 * CM_ALONG,
    size.half * 2 * CM_ALONG,
    size.h * CM_ALONG
  )
}
