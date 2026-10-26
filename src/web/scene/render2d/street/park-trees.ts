import type { CityScene } from '@/web/scene/render2d/street/city-blocks'
import type { Point } from '@/web/scene/types'
import { blossomOf } from '@/web/scene/render2d/street/festive-trees'
import { mixTone } from '@/web/scene/render2d/street/tone'
import { HEIGHT_K } from '@/web/scene/view'
import { createRng, seedOf } from '@/web/scene/world/rng'

const TREE_TONES = ['#7CC68A', '#5FAF72', '#8DD39A'] as const
const NIGHT = Object.freeze({
  tree: '#2B4558',
  treeShare: 0.8,
  trunk: '#1B1B28',
  trunkShare: 0.6,
  lamp: '#10131F',
  lampShare: 0.5,
})
const BIG = Object.freeze({
  deepen: '#2E7048',
  deepenShare: 0.3,
  shade: '#10301F',
  shadeShare: 0.38,
  highlight: '#FFFFFF',
  lighten: 0.2,
  trunk: '#7A5A3E',
  shadow: 'rgba(0,0,0,.16)',
  scale: { min: 1.5, span: 0.8 },
})
// Each big crown is a cluster of round blobs: x and y offsets and radius, as shares of the
// crown's radius.
const BIG_BLOBS = [
  [
    [0, 0, 1],
    [0.7, 0.25, 0.72],
    [-0.7, 0.2, 0.7],
    [0.32, -0.5, 0.6],
    [-0.38, -0.45, 0.58],
    [0, 0.5, 0.7],
  ],
  [
    [0, 0, 1],
    [0.62, 0.3, 0.66],
    [-0.58, 0.28, 0.6],
    [0.2, -0.6, 0.55],
    [-0.5, -0.3, 0.5],
  ],
  [
    [0, 0, 1],
    [-0.55, 0.35, 0.62],
    [0.6, 0.2, 0.64],
    [0, -0.6, 0.6],
    [0.4, 0.5, 0.5],
  ],
] as const
const BIG_RADII = [5.4, 6.4, 5] as const
const SCATTER = Object.freeze({ tries: 700, apartY: 1.5, apart: 0.85, crownRise: 2.1, top: 8 })
const PARK_LAMP = Object.freeze({
  pole: '#3F4D48',
  head: '#E9E4D4',
  headLit: '#FFE2A0',
  shadow: 'rgba(0,0,0,.12)',
  rise: 10,
  glowPx: 15,
  glowRgb: '255,214,130',
  onFrom: 0.12,
  onSpan: 0.76,
})
const LAWN = Object.freeze({
  tone: '#9BD1A4',
  stripe: '#A8D6AE',
  night: '#2B4558',
  tuft: '#86C093',
  tuftNight: '#22394A',
  share: 0.8,
  stripeEvery: 26,
  stripeH: 13,
  tufts: 34,
  tuftAlpha: 0.5,
})

/** A big park tree: its foot, its look and its scale. */
interface BigTree {
  readonly x: number
  readonly y: number
  readonly kind: number
  readonly scale: number
}

/** Where a park's big trees may stand and the boxes (x0, x1, y0, y1) their crowns keep off. */
export interface TreeArea {
  readonly seed: string
  readonly count: number
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
  readonly keep: readonly (readonly [number, number, number, number])[]
}

/** Seeded places for a park's big trees, each crown clear of the kept boxes and of the crowns
 *  already placed; north to south. */
export function scatterBigTrees(area: TreeArea): readonly BigTree[] {
  const rng = createRng(seedOf('park-trees', area.seed))
  const trees: (BigTree & { readonly r: number })[] = []

  for (let tries = 0; tries < SCATTER.tries && trees.length < area.count; tries++) {
    const x = area.x0 + rng.next() * (area.x1 - area.x0)
    const y = area.y0 + rng.next() * (area.y1 - area.y0)
    const scale = BIG.scale.min + rng.next() * BIG.scale.span
    const kind = rng.int(0, BIG_RADII.length - 1)
    const r = (BIG_RADII[kind] ?? BIG_RADII[0]) * scale
    const box = [x - r, x + r, y - r * SCATTER.crownRise - SCATTER.top, y + 2] as const
    const isKept = area.keep.some(
      (b) => box[0] < b[1] && box[1] > b[0] && box[2] < b[3] && box[3] > b[2]
    )
    const isCrowded = trees.some(
      (tree) => Math.hypot(tree.x - x, (tree.y - y) * SCATTER.apartY) < (tree.r + r) * SCATTER.apart
    )

    if (!(isKept || isCrowded)) {
      trees.push({ x, y, kind, scale, r })
    }
  }

  return trees.sort((a, b) => a.y - b.y)
}

/** A big park tree: a soft shadow, a tapered trunk, a cluster of blobs darker underneath and two
 *  highlights on top. */
export function paintBigTree(scene: CityScene, tree: BigTree): void {
  const { g, dark } = scene
  const look = tree.kind % BIG_RADII.length
  const radius = (BIG_RADII[look] ?? BIG_RADII[0]) * tree.scale
  const crownY = tree.y - (9 + look * 1.5) * HEIGHT_K * tree.scale * 0.7 - radius * 0.45
  const base = blossomOf(scene.holiday, look) ?? TREE_TONES[look] ?? TREE_TONES[0]
  const body = mixTone(
    mixTone(base, NIGHT.tree, dark * NIGHT.treeShare),
    BIG.deepen,
    BIG.deepenShare
  )
  const trunkW = 0.9 + tree.scale * 0.35

  g.fillStyle = BIG.shadow
  ellipse(g, { x: tree.x + radius * 0.2, y: tree.y }, { rx: radius * 1.1, ry: radius * 0.4 })
  g.fillStyle = mixTone(BIG.trunk, NIGHT.trunk, dark * NIGHT.trunkShare)
  g.beginPath()
  g.moveTo(tree.x - trunkW, tree.y)
  g.lineTo(tree.x - trunkW * 0.55, crownY + radius * 0.3)
  g.lineTo(tree.x + trunkW * 0.55, crownY + radius * 0.3)
  g.lineTo(tree.x + trunkW, tree.y)
  g.fill()

  paintBigCrown(g, { x: tree.x, y: crownY, radius, body, look })
}

// The crown's blobs, darker underneath, then two highlights on top.
function paintBigCrown(
  g: CanvasRenderingContext2D,
  crown: {
    readonly x: number
    readonly y: number
    readonly radius: number
    readonly body: string
    readonly look: number
  }
): void {
  const { x, y, radius, body } = crown

  for (const [tone, dy] of [
    [mixTone(body, BIG.shade, BIG.shadeShare), radius * 0.18],
    [body, 0],
  ] as const) {
    g.fillStyle = tone

    for (const [dx, oy, size] of BIG_BLOBS[crown.look] ?? BIG_BLOBS[0]) {
      g.beginPath()
      g.arc(x + dx * radius, y + oy * radius + dy, radius * size, 0, Math.PI * 2)
      g.fill()
    }
  }

  g.fillStyle = mixTone(body, BIG.highlight, BIG.lighten)
  ellipse(
    g,
    { x: x - radius * 0.32, y: y - radius * 0.36 },
    { rx: radius * 0.46, ry: radius * 0.46 }
  )
  ellipse(g, { x: x + radius * 0.38, y: y - radius * 0.2 }, { rx: radius * 0.3, ry: radius * 0.3 })
}

/** A short green park lamp with a round head; it lights once the darkness passes its own mark. */
export function paintParkLamp(scene: CityScene, at: Point): void {
  const { g, dark } = scene
  const top = at.y - PARK_LAMP.rise * HEIGHT_K
  const threshold =
    PARK_LAMP.onFrom +
    PARK_LAMP.onSpan * createRng(seedOf('park-lamp', String(at.x), String(at.y))).next()

  g.fillStyle = PARK_LAMP.shadow
  ellipse(g, { x: at.x, y: at.y + 0.2 }, { rx: 1.5, ry: 0.5 })
  g.fillStyle = mixTone(PARK_LAMP.pole, NIGHT.lamp, dark * NIGHT.lampShare)
  g.fillRect(at.x - 0.5, top + 1.4, 1, at.y - top - 1.4)
  g.fillRect(at.x - 1, at.y - 1, 2, 1)
  g.fillRect(at.x - 1.5, top - 0.9, 3, 0.6)

  if (dark > threshold) {
    const reach = PARK_LAMP.glowPx
    const glow = g.createRadialGradient(at.x, top + 0.6, 0, at.x, top + 0.6, reach)

    glow.addColorStop(0, `rgba(${PARK_LAMP.glowRgb},${0.8 * dark})`)
    glow.addColorStop(1, `rgba(${PARK_LAMP.glowRgb},0)`)
    g.fillStyle = glow
    g.fillRect(at.x - reach, top - reach + 0.6, reach * 2, reach * 2)
    g.fillStyle = `rgba(${PARK_LAMP.glowRgb},${0.2 * dark})`
    ellipse(g, { x: at.x, y: at.y + 1 }, { rx: 8, ry: 3 })
  }

  g.fillStyle = dark > threshold ? PARK_LAMP.headLit : PARK_LAMP.head
  g.fillRect(at.x - 1, top - 0.3, 2, 1.9)
}

/** A park's lawn: mown stripes and darker tufts, seeded per park. */
export function paintLawnTexture(
  scene: CityScene,
  lawn: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number },
  seed: string
): void {
  const { g, dark } = scene
  const { x0, x1, y0, y1 } = lawn
  const rng = createRng(seedOf('lawn', seed))

  g.fillStyle = mixTone(LAWN.tone, LAWN.night, dark * LAWN.share)
  g.fillRect(x0, y0, x1 - x0, y1 - y0)
  g.fillStyle = mixTone(LAWN.stripe, LAWN.night, dark * LAWN.share)

  for (let y = y0; y < y1; y += LAWN.stripeEvery) {
    g.fillRect(x0, y, x1 - x0, Math.min(LAWN.stripeH, y1 - y))
  }

  g.fillStyle = mixTone(LAWN.tuft, LAWN.tuftNight, dark * LAWN.share)
  g.globalAlpha = LAWN.tuftAlpha

  for (let index = 0; index < LAWN.tufts; index++) {
    const at = { x: x0 + rng.next() * (x1 - x0), y: y0 + rng.next() * (y1 - y0) }

    ellipse(g, at, { rx: 3 + rng.next() * 5, ry: 1.2 + rng.next() * 1.6 })
  }

  g.globalAlpha = 1
}

function ellipse(
  g: CanvasRenderingContext2D,
  at: Point,
  size: { readonly rx: number; readonly ry: number }
): void {
  g.beginPath()
  g.ellipse(at.x, at.y, size.rx, size.ry, 0, 0, Math.PI * 2)
  g.fill()
}
