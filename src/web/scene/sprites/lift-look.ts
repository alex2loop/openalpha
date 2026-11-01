import type { FloorId } from '@/web/scene/types'
import { GROUND_FLOOR, TEAM_FLOOR } from '@/web/scene/world/floors'

/** The lamps over the lift doors, left to right, one per floor, in both renderers. */
export const LIFT_LAMP_FLOORS: readonly FloorId[] = Object.freeze([GROUND_FLOOR, TEAM_FLOOR])
/** Each door leaf slides this share of its width into the jamb when the doors stand open. */
export const LIFT_LEAF_SLIDE = 0.85
