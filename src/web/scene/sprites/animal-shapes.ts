import type { AnimalKind, AnimalMotion, AnimalPart } from '@/web/scene/sprites/animal-parts'
import { catShape } from '@/web/scene/sprites/cat-shape'
import { corgiShape } from '@/web/scene/sprites/corgi-shape'
import { fishShape } from '@/web/scene/sprites/fish-shape'

const STEP_SWING = 0.45
const PI = Math.PI

/** The parts of `kind` in `pose` at detail `lv` (0 whole floor, 1 a room, 2 close). */
export function animalShape(kind: AnimalKind, pose: string, lv: number): readonly AnimalPart[] {
  if (kind === 'corgi') {
    return corgiShape(pose, lv)
  }

  return kind === 'cat' ? catShape(pose, lv) : fishShape(kind, lv)
}

/** How a part turns and stretches this frame. */
export function partMotion(
  kind: AnimalKind,
  name: string,
  motion: AnimalMotion
): { readonly az: number; readonly ay: number; readonly sy: number } {
  if (name.startsWith('leg')) {
    const sign = name === 'legFa' || name === 'legBb' ? STEP_SWING : -STEP_SWING

    return { az: motion.step * sign, ay: 0, sy: 1 }
  }

  if (name === 'tail') {
    return { az: 0, ay: motion.tail * (kind === 'cat' ? 0.22 : 0.3), sy: 1 }
  }

  if (name === 'front') {
    return { az: 0, ay: (motion.yaw * PI) / 8 - motion.tail * 0.03, sy: 1 }
  }

  if (name === 'rear') {
    return { az: 0, ay: motion.tail * 0.16, sy: 1 }
  }

  return { az: 0, ay: name === 'fin' ? motion.tail * 0.2 : 0, sy: 1 }
}
