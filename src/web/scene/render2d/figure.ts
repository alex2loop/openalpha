import type { Hair, Look } from '@/web/scene/sprites/parts'
import {
  paintArms,
  paintHeld,
  paintStaffGear,
  paintTorsoProp,
} from '@/web/scene/render2d/figure-arms'
import {
  type Figure,
  type FrameSpec,
  type Material,
  skinOf,
} from '@/web/scene/render2d/figure-spec'
import {
  type Cells,
  createCells,
  ellipse,
  put,
  rect,
  rounded,
} from '@/web/scene/render2d/pixel-grid'

const HEAD_R = 3.5
const TORSO_R = 2.5
// How far each hair style runs down the sides of the head, in rows.
const HAIR_SIDE_TO: Readonly<Record<Exclude<Hair, 'bald'>, number>> = Object.freeze({
  short: 8,
  bun: 8,
  cap: 8,
  bob: 10,
  long: 15,
})
const BACK_HAIR_H: Readonly<Record<Exclude<Hair, 'bald'>, number>> = Object.freeze({
  short: 8,
  bun: 8,
  cap: 8,
  bob: 10,
  long: 14,
})
// The arms' swing at each step of a walk: back with the left foot up, forward with the right.
const ARM_SWING = [0, -1, 0, 1] as const

/** The G anatomy: 3 px legs, a 10 by 9 torso, a 12 by 10 rounded head with a dot face. */
export function buildFigure(look: Look, frame: FrameSpec): Cells<Material> {
  const f = toFigure(look, frame)

  paintLegs(f)
  rounded(f.cells, { box: [7, 12 + f.b, 10, 9 - f.b], r: TORSO_R }, 'shirt')

  paintArms(f)
  paintHeld(f)
  paintTorsoProp(f)
  paintStaffGear(f)
  rect(f.cells, [10, 11 + f.hb, 4, 2], skinOf(f))
  rounded(f.cells, { box: [6, 2 + f.hb, 12, 10], r: HEAD_R }, skinOf(f))
  paintHair(f)
  paintHeadwear(f)
  paintFace(f)

  return f.cells
}

function toFigure(look: Look, frame: FrameSpec): Figure {
  const b = frame.isBob ? 1 : 0
  const arms = frame.isBack && frame.arms === 'type' ? 'down' : (frame.arms ?? 'down')
  const swing = ARM_SWING[frame.gait ?? 0]

  return {
    cells: createCells(),
    look,
    frame,
    b,
    hb: b + (frame.headDrop ?? 0),
    isFur: look.prop === 'bear',
    arms,
    isReading: frame.phone === 'read' && !frame.isBack && arms !== 'cheer',
    swing,
  }
}

function paintLegs(f: Figure): void {
  const { cells } = f
  const isLeftUp = f.frame.gait === 1
  const isRightUp = f.frame.gait === 3

  rect(cells, [8, 21, 3, isLeftUp ? 7 : 8], 'pants')
  rect(cells, [13, 21, 3, isRightUp ? 7 : 8], 'pants')
  rect(cells, [7, isLeftUp ? 27 : 29, 4, 2], 'shoe')
  rect(cells, [13, isRightUp ? 27 : 29, 4, 2], 'shoe')
}

function paintHair(f: Figure): void {
  const { look } = f

  if (f.isFur) {
    return
  }

  if (f.frame.isBack) {
    paintBackHair(f)
  } else if (look.hair === 'bald') {
    for (let y = 7; y <= 9; y++) {
      put(f.cells, [6, y + f.hb], 'hair')
      put(f.cells, [17, y + f.hb], 'hair')
    }
  } else {
    paintFrontHair(f, look.hair)
  }

  if (look.hair === 'bun') {
    ellipse(f.cells, { cx: 11.5, cy: 1.3 + f.hb, rx: 3, ry: 2 }, 'hair')
  }
}

function paintBackHair(f: Figure): void {
  const { cells, hb, look } = f

  if (look.hair === 'bald') {
    rect(cells, [6, 7 + hb, 12, 3], 'hair')
    return
  }

  rounded(cells, { box: [6, 2 + hb, 12, BACK_HAIR_H[look.hair]], r: HEAD_R }, 'hair')

  if (look.hair === 'cap') {
    rect(cells, [6, 2 + hb, 12, 3], 'cap')
  }
}

function paintFrontHair(f: Figure, hair: Exclude<Hair, 'bald'>): void {
  const { cells, hb } = f
  const crown: Material = hair === 'cap' ? 'cap' : 'hair'

  rect(cells, [7, 2 + hb, 10, 3], crown)
  put(cells, [6, 3 + hb], crown)
  put(cells, [17, 3 + hb], crown)

  for (let y = 5; y <= HAIR_SIDE_TO[hair]; y++) {
    put(cells, [6, y + hb], 'hair')
    put(cells, [17, y + hb], 'hair')

    if (hair === 'long' && y >= 9) {
      put(cells, [7, y + hb], 'hair')
      put(cells, [16, y + hb], 'hair')
    }
  }

  if (hair === 'short' || hair === 'bun') {
    rect(cells, [8, 5 + hb, 8, 1], 'hair')
  }

  if (hair === 'cap') {
    rect(cells, [5, 5 + hb, 14, 1], 'cap')
  }
}

// Horns, the bear's ears, a headset or a visor over the hair.
function paintHeadwear(f: Figure): void {
  const { cells, hb, look } = f
  const isFront = !f.frame.isBack

  switch (look.prop) {
    case 'horns':
      rect(cells, [6, hb, 2, 3], 'horn')
      rect(cells, [16, hb, 2, 3], 'horn')
      put(cells, [5, hb], 'horn')
      put(cells, [18, hb], 'horn')
      return
    case 'bear':
      ellipse(cells, { cx: 7.5, cy: 2.5 + hb, rx: 2.2, ry: 2.2 }, 'fur')
      ellipse(cells, { cx: 16.5, cy: 2.5 + hb, rx: 2.2, ry: 2.2 }, 'fur')
      put(cells, [7, 2 + hb], 'muzzle')
      put(cells, [16, 2 + hb], 'muzzle')
      return
    case 'headset':
      rect(cells, [6, 1 + hb, 12, 1], 'metal')
      rect(cells, [4, 6 + hb, 2, 4], 'metal')
      rect(cells, [18, 6 + hb, 2, 4], 'metal')

      if (isFront) {
        rect(cells, [16, 10 + hb, 3, 1], 'metal')
      }

      return
    case 'visor':
      rect(cells, [5, 3 + hb, 14, isFront ? 3 : 2], 'visor')
  }
}

function paintFace(f: Figure): void {
  const { cells, hb, look } = f

  if (f.frame.isBack) {
    return
  }

  if (look.prop === 'glasses') {
    rect(cells, [7, 6 + hb, 4, 3], 'lens')
    rect(cells, [13, 6 + hb, 4, 3], 'lens')
    rect(cells, [7, 6 + hb, 4, 1], 'frame')
    rect(cells, [13, 6 + hb, 4, 1], 'frame')
    rect(cells, [11, 6 + hb, 2, 1], 'frame')
  } else if (look.prop === 'monocle') {
    rect(cells, [13, 6 + hb, 3, 3], 'gold')
    rect(cells, [16, 9 + hb, 1, 2], 'gold')
    put(cells, [17, 11 + hb], 'gold')
  } else if (f.isFur) {
    ellipse(cells, { cx: 11.5, cy: 9 + hb, rx: 3, ry: 2 }, 'muzzle')
    rect(cells, [11, 7 + hb, 2, 1], 'nose')
  }

  paintEyes(f)
  paintMouth(f)
}

// Dot eyes with a glint, as the mockup draws them; a bear's eyes sit a row higher and never glint.
function paintEyes(f: Figure): void {
  const { cells, hb, frame } = f
  const ey = (f.isFur ? 5 : 6) + (frame.isDown === true ? 1 : 0) + hb
  const gx = frame.isAside === true ? 1 : 0

  if (frame.isBlink || frame.isShut === true) {
    put(cells, [9 + gx, ey + 1], 'eye')
    put(cells, [14 + gx, ey + 1], 'eye')
    return
  }

  rect(cells, [9 + gx, ey, 1, 2], 'eye')
  rect(cells, [14 + gx, ey, 1, 2], 'eye')

  if (!f.isFur && frame.isDown !== true) {
    put(cells, [10 + gx, ey], 'glint')
    put(cells, [15 + gx, ey], 'glint')
  }
}

function paintMouth(f: Figure): void {
  const { cells, hb } = f

  if (f.isFur) {
    return
  }

  if (f.frame.isYawn === true) {
    rect(cells, [11, 9 + hb, 2, 3], 'mouth')
  } else {
    rect(cells, [11, 10 + hb, 2, 1], 'mouth')
  }

  put(cells, [7, 8 + hb], 'blush')
  put(cells, [16, 8 + hb], 'blush')
}
