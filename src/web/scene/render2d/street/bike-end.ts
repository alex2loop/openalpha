import { card, type EndArt, quad, seg, spot, toPx } from '@/web/scene/render2d/street/bike-end-pen'
import {
  paintArms,
  paintHead,
  paintLegs,
  paintPillion,
  paintTorso,
} from '@/web/scene/render2d/street/bike-end-rider'
import {
  BIKE_TONES,
  type BikeArt,
  CM_ALONG,
  LIGHT,
  shade,
  wheelR,
} from '@/web/scene/render2d/street/bike-model'
import { mixTone } from '@/web/scene/render2d/street/tone'

type Part = (art: EndArt) => void

/** A motorbike from the front (heading south) or the back, from the ground under its middle;
 *  `isParked` leaves the rider off. Nearer parts are painted last. */
export function paintBikeEnd(
  art: BikeArt,
  at: { readonly dir: 1 | -1; readonly isParked: boolean }
): void {
  const end: EndArt = { ...art, tone: art.tone, dir: at.dir }
  const { g, look } = art

  g.fillStyle = BIKE_TONES.endShadow
  g.beginPath()
  g.ellipse(0.15, 0.2, 0.8, 3.1, 0, 0, Math.PI * 2)
  g.fill()

  for (const part of partsOf(at)) {
    part(end)
  }

  if (at.isParked) {
    return
  }

  if (look.isCoated && art.detail > 0 && at.dir > 0) {
    const [x, y] = toPx(end, [0, -6, 141])

    g.fillStyle = art.tone(look.mask)
    g.fillRect(x - 8 * CM_ALONG, y, 16 * CM_ALONG, 7 * CM_ALONG)
  }

  if (art.detail === 2 && at.dir > 0) {
    const [x, y] = toPx(end, [0, -6, 152])

    g.fillStyle = art.tone(BIKE_TONES.eye)
    g.fillRect(x - 5 * CM_ALONG, y - 0.1, 1.4 * CM_ALONG, 1.4 * CM_ALONG)
    g.fillRect(x + 3.6 * CM_ALONG, y - 0.1, 1.4 * CM_ALONG, 1.4 * CM_ALONG)
  }
}

function partsOf(at: { readonly dir: 1 | -1; readonly isParked: boolean }): readonly Part[] {
  if (at.isParked) {
    return [paintFrontWheel, paintShield, paintBars, paintRearWheel, paintCowl, paintTail]
  }

  return at.dir > 0
    ? [
        paintBox,
        paintPillion,
        paintRearWheel,
        paintCowl,
        paintTail,
        paintTorso,
        paintHead,
        paintLegs,
        paintShield,
        paintFrontWheel,
        paintArms,
        paintBars,
      ]
    : [
        paintFrontWheel,
        paintShield,
        paintBars,
        paintLegs,
        paintArms,
        paintTorso,
        paintHead,
        paintRearWheel,
        paintCowl,
        paintTail,
        paintPillion,
        paintBox,
      ]
}

function paintWheelAt(art: EndArt, f: number): void {
  const r = wheelR(art.look)

  seg(art, [0, f, 5, 0, f, r * 2 - 6], { w: 10, c: art.tone(BIKE_TONES.tyre) })

  if (art.detail > 0) {
    seg(art, [0, f, r, 0, f, r + 14], { w: 3, c: art.tone(BIKE_TONES.metal) })
  }
}

function paintFrontWheel(art: EndArt): void {
  const r = wheelR(art.look)

  paintWheelAt(art, 62)

  if (art.detail > 0) {
    card(art, [-8, 8, 62, r + 17, r + 23], art.tone(art.look.body))
  }
}

function paintRearWheel(art: EndArt): void {
  paintWheelAt(art, -62)
}

function paintCowl(art: EndArt): void {
  const { look } = art
  const body = art.tone(look.body)

  card(art, look.build === 'scooter' ? [-14, 14, -60, 52, 80] : [-12, 12, -60, 56, 78], body)
  card(
    art,
    [-13, 13, -54, 80, 90],
    art.tone(look.build === 'sport' ? BIKE_TONES.sportSeat : BIKE_TONES.seat)
  )

  if (art.detail > 0) {
    card(art, [-14, 14, -60, 76, 79], art.tone(mixTone(look.body, LIGHT.to, LIGHT.share)))
  }
}

function paintTail(art: EndArt): void {
  const plateLine = art.tone(BIKE_TONES.plateLine)

  card(art, [-13, 13, -100, 64, 72], BIKE_TONES.tail)
  card(art, [-10, 10, -98, 34, 52], art.tone(BIKE_TONES.plate))

  if (art.detail > 0) {
    card(art, [-10, 10, -98, 34, 35], plateLine)
    card(art, [-10, 10, -98, 51, 52], plateLine)
  }

  if (art.detail === 2) {
    card(art, [-6, 6, -98, 40, 41], art.tone(BIKE_TONES.plateMark))
    card(art, [-6, 6, -98, 44, 45], art.tone(BIKE_TONES.plateMark))
  }
}

function paintShield(art: EndArt): void {
  const { look } = art
  const body = art.tone(look.body)

  if (look.build === 'scooter') {
    quad(art, [-12, 48, 30, 12, 48, 30, 20, 48, 100, -20, 48, 100], body)

    if (art.detail > 0) {
      card(art, [-1.2, 1.2, 48, 34, 100], art.tone(mixTone(look.body, LIGHT.to, LIGHT.share)))
    }
  } else if (look.build === 'sport') {
    quad(art, [-8, 52, 34, 8, 52, 34, 18, 52, 104, -18, 52, 104], body)
  } else {
    card(art, [-10, 10, 40, 24, 60], art.tone(BIKE_TONES.engine))
    quad(art, [-5, 46, 34, 5, 46, 34, 10, 46, 98, -10, 46, 98], body)
  }

  if (art.dir > 0) {
    card(art, [-9, 9, 58, 82, 94], art.tone(BIKE_TONES.head))
  }

  if (art.dir > 0 && art.detail === 2) {
    spot(art, [[-17, 58, 96], 2.6, 2.6], art.tone(BIKE_TONES.indicator))
    spot(art, [[17, 58, 96], 2.6, 2.6], art.tone(BIKE_TONES.indicator))
  }
}

function paintBars(art: EndArt): void {
  const dark = art.tone(BIKE_TONES.dark)

  seg(art, [-38, 40, 108, 38, 40, 108], { w: 3, c: dark })

  if (art.detail === 0) {
    return
  }

  for (const side of [-1, 1]) {
    seg(art, [side * 34, 40, 112, side * 38, 40, 132], { w: 1.6, c: dark })
    spot(art, [[side * 38, 40, 135], 6.2, 5], dark)

    if (art.detail === 2) {
      spot(art, [[side * 38, 40, 135], 4, 3], art.tone(BIKE_TONES.mirror))
    }
  }
}

function paintBox(art: EndArt): void {
  const box = art.look.box

  if (box === undefined) {
    return
  }

  const near = art.dir > 0 ? -62 : -102
  const far = art.dir > 0 ? -102 : -62

  quad(
    art,
    [-21, near, 118, 21, near, 118, 21, far, 118, -21, far, 118],
    art.tone(mixTone(box, LIGHT.to, LIGHT.share))
  )
  card(art, [-21, 21, near, 76, 118], art.dir > 0 ? shade(art, box) : art.tone(box))

  if (art.detail === 2 && art.dir < 0) {
    card(art, [-21, 21, -102, 95, 97], shade(art, box))
  }
}
