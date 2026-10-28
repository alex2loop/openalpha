import type { StreetDetail } from '@/web/scene/render2d/street/detail'
import { mixTone } from '@/web/scene/render2d/street/tone'

// The machine is drawn in centimetres from a real one (wheelbase 1.25 m, seat 0.8 m, bars
// 1.1 m): world px per centimetre along it and up it.
export const CM_ALONG = 0.028
export const CM_UP = 0.026
export const SHADE = Object.freeze({ to: '#000000', share: 0.28 })
export const LIGHT = Object.freeze({ to: '#FFFFFF', share: 0.3 })
export const BIKE_TONES = Object.freeze({
  dark: '#23262F',
  metal: '#8F96A1',
  tyre: '#171A22',
  hub: '#5E6570',
  seat: '#262932',
  sportSeat: '#1F222B',
  board: '#2E323C',
  engine: '#3A3F4A',
  crank: '#565C68',
  head: '#FFF3C4',
  tail: '#D8453B',
  exhaust: '#8B919B',
  plate: '#EDEBE4',
  plateLine: '#3C4558',
  plateMark: '#5A6070',
  hair: '#23262E',
  glove: '#F0EEE8',
  sandal: '#E9E6DD',
  shoe: '#1D1F26',
  visor: 'rgba(190,215,235,.5)',
  fullVisor: 'rgba(18,22,32,.88)',
  mirror: '#9FB6C8',
  eye: '#1B1B22',
  strap: '#15171E',
  indicator: '#F0A53A',
  passengerHair: '#1B1B22',
  shadow: 'rgba(0,0,0,.16)',
  endShadow: 'rgba(0,0,0,.14)',
})

/** How a motorbike is built: a scooter, an underbone or a sport bike. */
export type BikeBuild = 'scooter' | 'underbone' | 'sport'

/** A helmet: an open half shell, one with a clear visor, or a full face. */
export type HelmetStyle = 'half' | 'visor' | 'full'

/** Whoever rides behind: their colours, and whether they sit side-saddle or are a pupil. */
export interface Pillion {
  readonly jacket: string
  readonly pants: string
  readonly helmet: string
  readonly skin: string
  readonly isSideSaddle: boolean
  readonly isPupil: boolean
}

/** Everything one motorbike and its rider are painted from. */
interface BikeLook {
  readonly build: BikeBuild
  readonly body: string
  readonly jacket: string
  readonly helmet: string
  readonly helmetStyle: HelmetStyle
  readonly skin: string
  readonly pants: string
  readonly mask: string
  readonly isCoated: boolean
  readonly pillion?: Pillion
  readonly box?: string
  readonly isFootDown: boolean
}

/** What a model painter reads: the canvas, the look, the detail and the night tone. */
export interface BikeArt {
  readonly g: CanvasRenderingContext2D
  readonly look: BikeLook
  readonly detail: StreetDetail
  tone(hex: string): string
}

type Quad = readonly [number, number, number, number]

/** A motorbike in profile facing east, from the ground under its middle: the far leg and arm,
 *  the box, wheels, frame and bodywork, the pillion, then the rider. */
export function paintBikeSide(art: BikeArt): void {
  const { g } = art

  g.fillStyle = BIKE_TONES.shadow
  g.beginPath()
  g.ellipse(0.1, 0.35, 2.7, 0.5, 0, 0, Math.PI * 2)
  g.fill()
  g.save()
  g.translate(0, 0.1)
  g.scale(CM_ALONG, CM_UP)
  paintFarLimbs(art)
  paintSideBox(art)
  paintWheel(art, -62)
  paintWheel(art, 62)
  paintFrame(art)
  paintFront(art)
  paintSidePillion(art)
  paintRider(art)
  g.restore()
}

export function wheelR(look: BikeLook): number {
  return look.build === 'underbone' ? 27 : 25
}

function seatFront(look: BikeLook): number {
  return look.build === 'scooter' ? -34 : -30
}

export function shade(art: BikeArt, hex: string): string {
  return art.tone(mixTone(hex, SHADE.to, SHADE.share))
}

function paintFarLimbs(art: BikeArt): void {
  const { look } = art
  const pants = shade(art, look.pants)
  const jacket = shade(art, look.jacket)
  const seat = seatFront(look)

  line(art.g, [seat, -84, 22, -76], { w: 16, c: pants })
  line(art.g, [22, -76, 17, -36], { w: 11, c: pants })
  line(art.g, [-16, -128, 8, -110], { w: 9, c: jacket })
  line(art.g, [8, -110, 40, -108], { w: 8, c: jacket })
}

function paintSideBox(art: BikeArt): void {
  const { g, look } = art

  if (look.box === undefined) {
    return
  }

  poly(g, [-106, -78, -62, -78, -62, -122, -106, -122], shade(art, look.box))
  poly(g, [-104, -82, -64, -82, -64, -120, -104, -120], art.tone(look.box))
  line(g, [-104, -100, -64, -100], { w: 1.2, c: shade(art, look.box) })
  poly(
    g,
    [-108, -122, -60, -122, -62, -126, -106, -126],
    art.tone(mixTone(look.box, LIGHT.to, LIGHT.share))
  )
}

function paintWheel(art: BikeArt, x: number): void {
  const { g } = art
  const r = wheelR(art.look)

  dot(g, [x, -r, r, r], art.tone(BIKE_TONES.tyre))

  if (art.detail > 0) {
    dot(g, [x, -r, r * 0.62, r * 0.62], art.tone(BIKE_TONES.metal))
    dot(g, [x, -r, r * 0.2, r * 0.2], art.tone(BIKE_TONES.dark))
  }

  if (art.detail === 2) {
    g.strokeStyle = art.tone(BIKE_TONES.hub)
    g.lineWidth = 1.3

    for (let spoke = 0; spoke < 5; spoke++) {
      const angle = spoke * 1.2566 + 0.3

      g.beginPath()
      g.moveTo(x, -r)
      g.lineTo(x + Math.cos(angle) * r * 0.6, -r + Math.sin(angle) * r * 0.6)
      g.stroke()
    }
  }
}

// The scooter's step-through body and board, or the underbone's and sport bike's tank, engine
// and tail, with the mudguard over the front wheel.
function paintFrame(art: BikeArt): void {
  const { g, look } = art
  const body = art.tone(look.body)
  const r = wheelR(look)

  if (look.build === 'scooter') {
    poly(g, [-99, -66, -95, -80, -12, -80, -6, -60, -2, -42, -24, -38, -50, -46, -80, -46], body)
    poly(g, [-4, -26, 36, -26, 38, -34, -2, -34], art.tone(BIKE_TONES.board))
    poly(
      g,
      [32, -30, 46, -30, 52, -48, 58, -72, 68, -92, 64, -104, 52, -106, 46, -98, 42, -76, 36, -52],
      body
    )

    if (art.detail > 0) {
      poly(g, [34, -32, 40, -32, 46, -60, 42, -62], shade(art, look.body))
      line(g, [-95, -79, -14, -79], {
        w: 1.4,
        c: art.tone(mixTone(look.body, LIGHT.to, LIGHT.share)),
      })
    }
  } else {
    paintTankFrame(art)
  }

  g.strokeStyle = body
  g.lineWidth = look.build === 'scooter' ? 5 : 4.5
  g.beginPath()
  g.arc(62, -r, r + 4, Math.PI * 1.12, Math.PI * 1.9)
  g.stroke()
}

function paintTankFrame(art: BikeArt): void {
  const { g, look } = art
  const body = art.tone(look.body)

  poly(g, [-96, -66, -92, -78, -8, -78, 0, -62, -6, -50, -50, -54, -86, -54], body)
  poly(g, [-4, -50, 34, -44, 36, -24, 0, -24], art.tone(BIKE_TONES.engine))

  if (art.detail > 0) {
    dot(g, [18, -34, 9, 8], art.tone(BIKE_TONES.crank))
    line(g, [-95, -84, -74, -84], { w: 2, c: art.tone(BIKE_TONES.metal) })
  }

  poly(g, [38, -34, 44, -34, 53, -70, 58, -98, 52, -102, 46, -96, 40, -60], body)

  if (look.build === 'sport') {
    poly(g, [34, -60, 60, -66, 72, -88, 62, -104, 50, -104, 44, -82], body)
    poly(g, [-2, -70, 40, -76, 42, -92, 18, -90], shade(art, look.body))
    poly(g, [-100, -86, -82, -80, -82, -76, -98, -78], body)
  }
}

// Seat, fork, headlamp, bars and mirror, the tail lamp and the exhaust.
function paintFront(art: BikeArt): void {
  const { g, look } = art
  const dark = art.tone(BIKE_TONES.dark)
  const r = wheelR(look)

  poly(
    g,
    [-86, -80, -14, -80, -8, -87, -30, -91, -72, -91],
    art.tone(look.build === 'sport' ? BIKE_TONES.sportSeat : BIKE_TONES.seat)
  )
  line(g, [56, -90, 62, -r], { w: 4, c: art.tone(BIKE_TONES.metal) })
  dot(g, [look.build === 'scooter' ? 64 : 60, -88, 5, 5.6], art.tone(BIKE_TONES.head))
  line(g, [50, -102, 46, -110], { w: 3, c: dark })
  dot(g, [43, -110, 7, 3.4], dark)

  if (art.detail > 0) {
    line(g, [48, -111, 40, -132], { w: 1.6, c: dark })
    dot(g, [38, -135, 5.4, 3.6], dark)
    dot(g, [-74, -26, 2.4, 3], dark)
  }

  if (art.detail === 2) {
    dot(g, [37.5, -135.4, 3.6, 2.2], art.tone(BIKE_TONES.mirror))
  }

  poly(g, [-103, -74, -99, -74, -99, -62, -103, -62], BIKE_TONES.tail)
  poly(g, [-72, -34, -20, -30, -18, -22, -74, -24], art.tone(BIKE_TONES.exhaust))
}

function paintSidePillion(art: BikeArt): void {
  const { g, look } = art
  const pillion = look.pillion

  if (pillion === undefined) {
    return
  }

  const jacket = art.tone(pillion.jacket)
  const skin = art.tone(pillion.skin)

  if (pillion.isSideSaddle) {
    line(g, [-58, -84, -55, -44], { w: 22, c: art.tone(mixTone(pillion.jacket, SHADE.to, 0.1)) })
    dot(g, [-55, -36, 10, 4.5], art.tone(BIKE_TONES.dark))
    line(g, [-60, -90, -60, -128], { w: 30, c: jacket })
    dot(g, [-60, -148, 11.5, 12], art.tone(BIKE_TONES.passengerHair))
    dot(g, [-59, -146, 9, 10], skin)
  } else {
    line(g, [-68, -82, -30, -90], { w: 16, c: art.tone(pillion.pants) })
    line(g, [-30, -90, -38, -40], { w: 11, c: art.tone(pillion.pants) })
    dot(g, [-34, -35, 10, 4.6], art.tone(BIKE_TONES.dark))
    line(g, [-66, -90, -62, -130], { w: 24, c: jacket })
    dot(g, [-60, -148, 10.5, 11], skin)
  }

  line(g, [-60, -124, -34, -102], { w: 8, c: shade(art, pillion.jacket) })
  dot(g, [-32, -100, 4.5, 4.5], skin)
  paintSideHelmet(art, {
    at: [pillion.isSideSaddle ? -60 : -61, pillion.isSideSaddle ? -152 : -153],
    style: pillion.isPupil ? 'half' : 'visor',
    colour: pillion.helmet,
  })
}

// The rider: legs (a foot down when stopped), torso and sun coat, neck, near arm and hand,
// head, hair under the helmet, the helmet and the mask.
function paintRider(art: BikeArt): void {
  const { g, look } = art
  const pants = art.tone(look.pants)
  const jacket = art.tone(look.jacket)
  const shoe = art.tone(BIKE_TONES.sandal)
  const seat = seatFront(look)

  if (look.isFootDown) {
    line(g, [seat, -84, 30, -62], { w: 18, c: pants })
    line(g, [30, -62, 36, -7], { w: 12, c: pants })
    dot(g, [40, -3, 11, 4.5], shoe)
  } else {
    line(g, [seat, -84, 28, -76], { w: 18, c: pants })
    line(g, [28, -76, 22, -34], { w: 12, c: pants })
    dot(g, [26, -31, 11, 5], shoe)
  }

  line(g, [seat, -92, -14, -130], { w: 25, c: jacket })

  if (look.isCoated) {
    line(g, [seat - 6, -78, 14, -70], { w: 22, c: jacket })
    line(g, [-40, -70, -4, -64], { w: 12, c: shade(art, look.jacket) })
  }

  line(g, [-12, -138, -9, -146], { w: 8, c: art.tone(look.skin) })
  line(g, [-16, -128, 10, -110], { w: 10, c: jacket })
  line(g, [10, -110, 41, -108], { w: 8.6, c: jacket })
  dot(g, [44, -108, 5, 5], art.tone(look.isCoated ? BIKE_TONES.glove : look.skin))
  paintRiderHead(art)
}

function paintRiderHead(art: BikeArt): void {
  const { g, look } = art

  dot(g, [-7, -150, 10.5, 11], art.tone(look.skin))

  if (art.detail > 0 && !look.isCoated) {
    dot(g, [-17, -146, 7, 8], art.tone(BIKE_TONES.hair))
  }

  paintSideHelmet(art, { at: [-8, -155], style: look.helmetStyle, colour: look.helmet })

  if (look.isCoated && art.detail > 0) {
    poly(g, [-2, -148, 12, -148, 11, -139, -3, -139], art.tone(look.mask))
  }

  if (art.detail === 2) {
    dot(g, [4, -151, 1.3, 1.3], art.tone(BIKE_TONES.eye))
  }
}

function paintSideHelmet(
  art: BikeArt,
  helmet: {
    readonly at: readonly [number, number]
    readonly style: HelmetStyle
    readonly colour: string
  }
): void {
  const { g } = art
  const [x, y] = helmet.at
  const shell = art.tone(helmet.colour)
  const shine = art.tone(mixTone(helmet.colour, LIGHT.to, 0.32))

  if (helmet.style === 'full') {
    dot(g, [x, y, 16, 15.5], shell)
    poly(g, [x + 1, y + 4, x + 15, y + 3, x + 14, y + 14, x - 1, y + 13], shell)
    poly(g, [x + 3, y - 6, x + 17, y - 3, x + 16, y + 5, x + 3, y + 5], BIKE_TONES.fullVisor)
  } else {
    g.beginPath()
    g.ellipse(x, y, 16, 14.5, 0, Math.PI, Math.PI * 2)
    g.closePath()
    g.fillStyle = shell
    g.fill()
    poly(g, [x - 16, y, x - 15, y + 9, x - 7, y + 9, x - 3, y], shell)
    poly(
      g,
      helmet.style === 'visor'
        ? [x + 4, y - 9, x + 18, y - 3, x + 17, y + 9, x + 5, y + 7]
        : [x + 8, y - 2, x + 23, y + 1, x + 22, y + 4, x + 8, y + 2],
      helmet.style === 'visor' ? BIKE_TONES.visor : shine
    )
  }

  if (art.detail > 0) {
    dot(g, [x - 5, y - 9, 6.5, 2.4], shine)
  }

  if (art.detail === 2) {
    line(g, [x - 1, y + 4, x - 5, y + 17], { w: 1.2, c: art.tone(BIKE_TONES.strap) })
  }
}

export function poly(g: CanvasRenderingContext2D, points: readonly number[], colour: string): void {
  g.beginPath()
  g.moveTo(points[0] ?? 0, points[1] ?? 0)

  for (let index = 2; index < points.length; index += 2) {
    g.lineTo(points[index] ?? 0, points[index + 1] ?? 0)
  }

  g.closePath()
  g.fillStyle = colour
  g.fill()
}

export function line(
  g: CanvasRenderingContext2D,
  at: Quad,
  pen: { readonly w: number; readonly c: string }
): void {
  g.strokeStyle = pen.c
  g.lineWidth = pen.w
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(at[0], at[1])
  g.lineTo(at[2], at[3])
  g.stroke()
}

export function dot(g: CanvasRenderingContext2D, at: Quad, colour: string): void {
  g.fillStyle = colour
  g.beginPath()
  g.ellipse(at[0], at[1], at[2], at[3], 0, 0, Math.PI * 2)
  g.fill()
}
