import { type Art, ellipse, line, poly, STRIDE } from '@/web/scene/render2d/street/critter-shapes'

const CAT = Object.freeze({
  fur: '#858A92',
  dark: '#4F545D',
  white: '#E4E2DE',
  eye: '#B9B24F',
  glow: '#F2D26B',
})
const DOG = Object.freeze({
  coat: '#D38B49',
  shade: '#B97839',
  cream: '#F1E4CE',
  collar: '#3E6FB0',
  nose: '#1C1C22',
})
// Cat eyes shine from this darkness.
const EYE_SHINE_FROM = 0.5

// The stray grey tabby: sitting with its tail round its feet, washing a paw, or walking the wall
// top with its tail up; its eyes catch the light at night.
export function paintCat(art: Art): void {
  const { g, critter, tone } = art
  const isWalk = critter.pose === 'walk'
  const head: [number, number] = isWalk ? [18, -21.6] : [7.5, critter.pose === 'groom' ? -20 : -24]

  if (isWalk) {
    const stride = STRIDE[critter.frame] ?? 0

    line(g, { from: [-11, -16], to: [-21, -30], w: 3.9, tone: tone(CAT.fur) })

    for (const [x, reach] of [
      [9, -stride],
      [-9, stride],
    ] as const) {
      line(g, { from: [x, -11], to: [x + reach, 0], w: 3.8, tone: tone(CAT.dark) })
      line(g, { from: [x, -11], to: [x - reach, 0], w: 4, tone: tone(CAT.fur) })
    }

    ellipse(g, { x: 0, y: -15, rx: 13.5, ry: 6.4, rot: 0, tone: tone(CAT.fur) })
    ellipse(g, { x: 8, y: -14.6, rx: 6.4, ry: 6.4, rot: 0, tone: tone(CAT.fur) })
  } else {
    line(g, { from: [-12, -5], to: [8, -0.4], w: 4.6, tone: tone(CAT.fur) })
    ellipse(g, { x: -6, y: -7.5, rx: 8.8, ry: 7.5, rot: 0, tone: tone(CAT.fur) })
    ellipse(g, { x: 3.5, y: -13, rx: 5.4, ry: 7.6, rot: 0, tone: tone(CAT.fur) })

    if (art.detail >= 1) {
      ellipse(g, { x: 5.4, y: -12.6, rx: 3, ry: 5.8, rot: 0.05, tone: tone(CAT.white) })
    }

    const paw = critter.pose === 'groom' ? -16.6 + critter.frame * 1.8 : -1.8

    line(g, { from: [6, -12], to: [7.6, paw], w: 4.2, tone: tone(CAT.fur) })
  }

  paintCatHead(art, head)
}

function paintCatHead(art: Art, head: readonly [number, number]): void {
  const { g, tone } = art
  const [x, y] = head
  const isShining = art.dark >= EYE_SHINE_FROM

  ellipse(g, { x, y, rx: 7, ry: 6.3, rot: 0, tone: tone(CAT.fur) })
  poly(g, tone(CAT.dark), [x - 4.6, y - 3.4, x - 3.2, y - 10.4, x + 1.2, y - 5.2])
  poly(g, tone(CAT.fur), [x + 1.4, y - 5.2, x + 4.8, y - 9.8, x + 5.4, y - 2.8])

  if (art.detail >= 1) {
    ellipse(g, { x: x + 4.8, y: y + 2.5, rx: 3.4, ry: 2.5, rot: 0, tone: tone(CAT.white) })
  }

  if (isShining || art.detail >= 1) {
    ellipse(g, {
      x: x + 3.6,
      y: y - 1.2,
      rx: 1.3,
      ry: 1.3,
      rot: 0,
      tone: isShining ? CAT.glow : tone(CAT.eye),
    })
  }
}

// The walker's Shiba: tan with cream cheeks and chest, upright ears, a tail curled over its back,
// trotting on a diagonal gait; nose to the ground while its walker waits.
export function paintDog(art: Art): void {
  const { g, critter, tone } = art
  const stride = STRIDE[critter.frame] ?? 0
  const isSniff = critter.pose === 'sniff'

  line(g, { from: [13, -14], to: [13 - stride, 0], w: 5.6, tone: tone(DOG.shade) })
  line(g, { from: [-13, -18], to: [-13 + stride, 0], w: 5.6, tone: tone(DOG.shade) })
  line(g, { from: [-19, -27], to: [-26, -44], w: 8.4, tone: tone(DOG.coat) })
  line(g, { from: [-26, -44], to: [-12, -39], w: 8.4, tone: tone(DOG.coat) })
  ellipse(g, { x: 0, y: -25, rx: 21, ry: 10.6, rot: 0, tone: tone(DOG.coat) })
  ellipse(g, { x: 13, y: -23, rx: 9.8, ry: 11, rot: 0, tone: tone(DOG.coat) })

  if (art.detail >= 1) {
    ellipse(g, { x: 0, y: -17.6, rx: 15.6, ry: 4.2, rot: 0, tone: tone(DOG.cream) })
    line(g, { from: [19, -31.4], to: [25, -35.4], w: 2.6, tone: tone(DOG.collar) })
  }

  line(g, { from: [13, -14], to: [13 + stride, 0], w: 5.6, tone: tone(DOG.coat) })
  line(g, { from: [-13, -18], to: [-13 - stride, 0], w: 5.6, tone: tone(DOG.coat) })
  line(g, { from: [17, -28], to: [25, -36], w: 12, tone: tone(DOG.coat) })
  g.save()
  g.translate(25 + (isSniff ? 3 : 0), -36 + (isSniff ? 11 : 0))
  g.rotate(isSniff ? 0.5 : 0)
  poly(g, tone(DOG.shade), [4, -6, 8, -16, 10.6, -6])
  poly(g, tone(DOG.coat), [-2.4, -5, -0.5, -16, 6.8, -6.8])
  ellipse(g, { x: 4, y: -1, rx: 8.5, ry: 7, rot: 0.1, tone: tone(DOG.coat) })
  ellipse(g, {
    x: 11.5,
    y: 0.8,
    rx: 6.4,
    ry: 3.2,
    rot: 0.08,
    tone: tone(art.detail >= 1 ? DOG.cream : DOG.coat),
  })
  ellipse(g, { x: 17.4, y: -0.2, rx: 1.9, ry: 1.6, rot: 0, tone: DOG.nose })
  g.restore()
}
