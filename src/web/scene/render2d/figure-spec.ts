import type { Cells } from '@/web/scene/render2d/pixel-grid'
import type { Arms, PoseFrame } from '@/web/scene/sim/actors/poses'
import type { PALETTE } from '@/web/scene/sprites/palette'
import type { Look } from '@/web/scene/sprites/parts'
import type { SheetView } from '@/web/scene/types'

type FixedRamp =
  | 'fur'
  | 'shoe'
  | 'horn'
  | 'metal'
  | 'visor'
  | 'cap'
  | 'apron'
  | 'scarf'
  | 'board'
  | 'book'

/** What one sprite pixel is made of; the colouring pass turns it into a band of its ramp. */
export type Material =
  | FixedRamp
  | keyof typeof PALETTE
  | 'skin'
  | 'hair'
  | 'brow'
  | 'shirt'
  | 'pants'
  | 'phoneBody'
  | 'phoneEdge'
  | 'phonePlate'
  | 'heldBody'
  | 'heldBand'
  | 'stamp'

/** Everything one sprite shows besides the look: the pose frame and the moment's details. */
export interface FrameSpec extends PoseFrame {
  readonly isBack: boolean
  readonly isBob: boolean
  readonly isBlink: boolean
  readonly isWorking: boolean
  /** Which of the phone finishes a held phone wears. */
  readonly finish: number
  /** A sheet in hand; `blank` until stamped. */
  readonly sheet?: NonNullable<SheetView['action']> | 'blank'
}

/** One figure being built: its pixels, and what every painter reads from the look and frame. */
export interface Figure {
  readonly cells: Cells<Material>
  readonly look: Look
  readonly frame: FrameSpec
  /** The breathing bob, and the head's own offset on top of it. */
  readonly b: number
  readonly hb: number
  readonly isFur: boolean
  readonly arms: Arms
  readonly isReading: boolean
  /** The arms' swing with the gait: -1, 0 or 1. */
  readonly swing: number
}

export function skinOf(f: Figure): Material {
  return f.isFur ? 'fur' : 'skin'
}
