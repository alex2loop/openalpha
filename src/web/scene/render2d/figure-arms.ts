import type { Arms, HeldKind } from '@/web/scene/sim/actors/poses'
import { type Figure, type Material, skinOf } from '@/web/scene/render2d/figure-spec'
import { type Cells, put, rect } from '@/web/scene/render2d/pixel-grid'

const RIGHT_FREE_ARMS: ReadonlySet<Arms> = new Set(['down', 'type', 'cross', 'nap'])
const MUG_ARMS: ReadonlySet<Arms> = new Set(['down', 'hand', 'cross', 'nap', 'scratch', 'sip'])

const ARM_PAINTERS: Readonly<Record<Arms, (f: Figure) => void>> = Object.freeze({
  down: (f) => {
    leftArm(f)
    rightArm(f)
  },
  type: paintTyping,
  hand: paintHand,
  cheer: paintCheer,
  relax: paintRelax,
  cross: paintCross,
  nap: paintNap,
  shrug: paintShrug,
  scratch: paintScratch,
  sip: paintSip,
})

/** The arms the frame asks for, or a phone read in both hands. */
export function paintArms(f: Figure): void {
  if (f.isReading) {
    paintReading(f)
  } else {
    ARM_PAINTERS[f.arms](f)
  }
}

function leftArm(f: Figure): void {
  rect(f.cells, [5, 13 + f.b, 2, 6 + f.swing], 'shirt')
  rect(f.cells, [5, 19 + f.b + f.swing, 2, 2], skinOf(f))
}

function rightArm(f: Figure): void {
  rect(f.cells, [17, 13 + f.b, 2, 6 - f.swing], 'shirt')
  rect(f.cells, [17, 19 + f.b - f.swing, 2, 2], skinOf(f))
}

function paintTyping(f: Figure): void {
  const { cells, b } = f
  const beat = f.frame.beat ?? 0

  rect(cells, [5, 13 + b, 2, 4], 'shirt')
  rect(cells, [17, 13 + b, 2, 4], 'shirt')
  rect(cells, [7, 17 + b, 3, 2], 'shirt')
  rect(cells, [14, 17 + b, 3, 2], 'shirt')
  rect(cells, [9, 19 + b + beat, 2, 2], skinOf(f))
  rect(cells, [13, 20 + b - beat, 2, 2], skinOf(f))
}

// The right hand up: asking, pointing, waving, a phone at the ear or a sheet held high.
function paintHand(f: Figure): void {
  const { cells, b } = f

  leftArm(f)
  rect(cells, [17, 13 + b, 2, 2], 'shirt')
  rect(cells, [18, 8 + b, 2, 6], 'shirt')
  rect(cells, [f.frame.isWave === true ? 19 : 18, 6 + b, 2, 2], skinOf(f))

  if (f.frame.phone === 'call') {
    paintCallPhone(f)
  } else if (f.frame.sheet !== undefined) {
    paintRaisedSheet(f)
  }
}

function paintCheer(f: Figure): void {
  const { cells, b } = f

  rect(cells, [4, 5 + b, 2, 8], 'shirt')
  rect(cells, [18, 5 + b, 2, 8], 'shirt')
  rect(cells, [5, 12 + b, 2, 2], 'shirt')
  rect(cells, [17, 12 + b, 2, 2], 'shirt')
  rect(cells, [4, 3 + b, 2, 2], skinOf(f))
  rect(cells, [18, 3 + b, 2, 2], skinOf(f))
}

// Hands behind the head.
function paintRelax(f: Figure): void {
  const { cells, b } = f

  rect(cells, [4, 8 + b, 2, 6], 'shirt')
  rect(cells, [18, 8 + b, 2, 6], 'shirt')
  rect(cells, [5, 12 + b, 2, 2], 'shirt')
  rect(cells, [17, 12 + b, 2, 2], 'shirt')
  rect(cells, [5, 6 + b, 2, 2], skinOf(f))
  rect(cells, [17, 6 + b, 2, 2], skinOf(f))
}

function paintCross(f: Figure): void {
  const { cells, b } = f

  rect(cells, [5, 13 + b, 2, 5], 'shirt')
  rect(cells, [17, 13 + b, 2, 5], 'shirt')
  rect(cells, [7, 17 + b, 10, 2], 'shirt')
  rect(cells, [6, 17 + b, 2, 2], skinOf(f))
  rect(cells, [16, 17 + b, 2, 2], skinOf(f))
}

// Arms folded on the desk for the head to rest on.
function paintNap(f: Figure): void {
  const { cells, b } = f

  rect(cells, [4, 17 + b, 16, 3], 'shirt')
  rect(cells, [3, 18 + b, 2, 2], skinOf(f))
  rect(cells, [19, 18 + b, 2, 2], skinOf(f))
}

function paintShrug(f: Figure): void {
  const { cells, b } = f

  rect(cells, [5, 13 + b, 2, 4], 'shirt')
  rect(cells, [17, 13 + b, 2, 4], 'shirt')
  rect(cells, [3, 15 + b, 2, 2], skinOf(f))
  rect(cells, [19, 15 + b, 2, 2], skinOf(f))
}

function paintScratch(f: Figure): void {
  const { cells, b } = f

  leftArm(f)
  rect(cells, [17, 13 + b, 2, 2], 'shirt')
  rect(cells, [18, 8 + b, 2, 6], 'shirt')
  rect(cells, [17, 5 + f.hb + (f.frame.beat ?? 0), 2, 2], skinOf(f))
}

function paintSip(f: Figure): void {
  const { cells, b } = f

  leftArm(f)
  rect(cells, [17, 13 + b, 2, 4], 'shirt')
  rect(cells, [15, 15 + b, 2, 2], skinOf(f))
  rect(cells, [14, 12 + b, 3, 1], 'cupRim')
  rect(cells, [14, 13 + b, 3, 3], 'heldBody')
}

// A phone in both hands in front of the chest, its screen lit.
function paintReading(f: Figure): void {
  const { cells, b } = f

  rect(cells, [5, 13 + b, 2, 4], 'shirt')
  rect(cells, [17, 13 + b, 2, 4], 'shirt')
  rect(cells, [9, 12 + b, 6, 9], 'phoneBody')
  rect(cells, [9, 12 + b, 6, 1], 'phoneEdge')
  rect(cells, [10, 13 + b, 4, 7], 'screen')
  rect(cells, [11, 13 + b, 2, 1], 'bezel')
  rect(cells, [10, 15 + b, 3, 1], 'text')
  rect(cells, [10, 17 + b, 4, 1], 'line')
  rect(cells, [10, 19 + b, 4, 1], 'text')
  rect(cells, [7, 17 + b, 2, 2], skinOf(f))
  rect(cells, [15, 17 + b, 2, 2], skinOf(f))
}

function paintCallPhone(f: Figure): void {
  const { cells, b } = f

  rect(cells, [20, 1 + b, 4, 9], 'phoneBody')
  rect(cells, [20, 1 + b, 4, 1], 'phoneEdge')
  rect(cells, [20, 2 + b, 1, 8], 'phoneEdge')
  rect(cells, [21, 2 + b, 3, 3], 'phonePlate')
  put(cells, [21, 2 + b], 'glass')
  put(cells, [21, 4 + b], 'glass')
  put(cells, [22, 3 + b], 'glass')
  put(cells, [23, 2 + b], 'flash')
}

function paintRaisedSheet(f: Figure): void {
  const { cells, b } = f

  rect(cells, [19, b, 5, 8], 'paper')
  rect(cells, [20, 2 + b, 3, 1], 'line')
  rect(cells, [20, 4 + b, 3, 1], 'line')

  if (f.frame.sheet !== 'blank') {
    rect(cells, [20, 5 + b, 2, 2], 'stamp')
  }
}

// What hangs at a lowered right hand: a cup beside it, a bag below, a box or a sheet in front.
export function paintHeld(f: Figure): void {
  if (f.arms === 'type' && f.frame.sheet !== undefined) {
    paintDeskSheet(f)
    return
  }

  if (f.arms !== 'down' || f.isReading) {
    return
  }

  const hy = 19 + f.b - f.swing
  const kind = f.frame.hold

  if (kind !== undefined) {
    paintHeldKind(f.cells, { kind, hy })
  } else if (f.frame.sheet !== undefined) {
    rect(f.cells, [19, hy - 3, 4, 5], 'paper')
    rect(f.cells, [20, hy - 2, 2, 1], 'line')

    if (f.frame.sheet !== 'blank') {
      rect(f.cells, [20, hy, 2, 1], 'stamp')
    }
  }
}

// The sheet flat under the hands while it is read or stamped.
function paintDeskSheet(f: Figure): void {
  rect(f.cells, [8, 21 + f.b, 8, 2], 'paper')

  if (f.frame.sheet !== 'blank') {
    rect(f.cells, [11, 21 + f.b, 2, 1], 'stamp')
  }
}

function paintHeldKind(
  cells: Cells<Material>,
  held: { readonly kind: HeldKind; readonly hy: number }
): void {
  const { hy } = held

  switch (held.kind) {
    case 'cup':
      rect(cells, [19, hy - 3, 3, 1], 'cupRim')
      rect(cells, [19, hy - 2, 3, 4], 'heldBody')
      rect(cells, [19, hy - 1, 3, 1], 'heldBand')
      put(cells, [20, hy - 4], 'heldBand')
      put(cells, [20, hy - 5], 'heldBand')
      return
    case 'bag':
      rect(cells, [19, hy + 1, 4, 5], 'heldBody')
      rect(cells, [19, hy + 1, 4, 1], 'heldBand')
      put(cells, [19, hy], 'heldBand')
      put(cells, [22, hy], 'heldBand')
      rect(cells, [20, hy - 1, 2, 1], 'heldBand')
      return
    case 'box':
      rect(cells, [18, hy - 2, 5, 3], 'heldBody')
      rect(cells, [18, hy - 1, 5, 1], 'heldBand')
      rect(cells, [18, hy + 1, 5, 1], 'heldBand')
      return
    case 'item':
      rect(cells, [19, hy - 1, 3, 3], 'heldBody')
      return
    case 'mop':
      rect(cells, [21, hy - 8, 1, 17], 'heldBody')
      rect(cells, [19, hy + 9, 5, 2], 'heldBand')
  }
}

export function paintTorsoProp(f: Figure): void {
  const { cells, b, look } = f

  if (f.frame.isBack) {
    return
  }

  const isRightFree =
    RIGHT_FREE_ARMS.has(f.arms) && f.frame.hold === undefined && f.frame.sheet === undefined

  switch (look.prop) {
    case 'tie':
      rect(cells, [11, 13 + b, 2, 6], 'tie')
      return
    case 'apron':
      rect(cells, [8, 15 + b, 8, 6], 'apron')
      rect(cells, [10, 18 + b, 4, 2], 'pocket')
      return
    case 'lanyard':
      paintLanyard(f)
      return
    case 'scarf':
      rect(cells, [7, 12 + b, 10, 2], 'scarf')
      rect(cells, [13, 14 + b, 2, 3], 'scarf')
      return
    case 'uniform':
      rect(cells, [7, 12 + b, 2, 1], 'tie')
      rect(cells, [15, 12 + b, 2, 1], 'tie')
      put(cells, [9, 14 + b], 'gold')
      rect(cells, [8, 20 + b, 8, 1], 'pocket')
      return
    case 'vest':
      rect(cells, [7, 13 + b, 3, 8], 'vest')
      rect(cells, [14, 13 + b, 3, 8], 'vest')
      rect(cells, [7, 17 + b, 3, 1], 'vestBand')
      rect(cells, [14, 17 + b, 3, 1], 'vestBand')
      return
    default:
      paintCarriedProp(f, isRightFree)
  }
}

function paintLanyard(f: Figure): void {
  if (f.isReading) {
    return
  }

  for (let y = 12; y < 17; y++) {
    put(f.cells, [10, y + f.b], 'lanyard')
    put(f.cells, [13, y + f.b], 'lanyard')
  }

  rect(f.cells, [11, 17 + f.b, 2, 2], 'badge')
}

// A clipboard, scroll or book at a free right hand; a mug at the left.
function paintCarriedProp(f: Figure, isRightFree: boolean): void {
  const { cells, b, look } = f

  if (look.prop === 'mug' && MUG_ARMS.has(f.arms)) {
    rect(cells, [2, 19 + b, 3, 3], 'paper')
    put(cells, [1, 20 + b], 'paper')
    return
  }

  if (!isRightFree) {
    return
  }

  if (look.prop === 'clipboard') {
    rect(cells, [19, 16 + b, 4, 6], 'board')
    rect(cells, [20, 17 + b, 2, 4], 'paper')
  } else if (look.prop === 'scroll') {
    rect(cells, [19, 19 + b, 4, 3], 'paper')
  } else if (look.prop === 'book') {
    rect(cells, [19, 18 + b, 3, 4], 'book')
  }
}
