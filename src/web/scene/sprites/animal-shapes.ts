import type { AnimalKind, AnimalPart } from '@/web/scene/sprites/animal-parts'
import { catShape } from '@/web/scene/sprites/cat-shape'
import { corgiShape } from '@/web/scene/sprites/corgi-shape'
import { fishShape } from '@/web/scene/sprites/fish-shape'

/** The parts of `kind` in `pose` at detail `lv` (0 whole floor, 1 a room, 2 close). */
export function animalShape(kind: AnimalKind, pose: string, lv: number): readonly AnimalPart[] {
  if (kind === 'corgi') {
    return corgiShape(pose, lv)
  }

  return kind === 'cat' ? catShape(pose, lv) : fishShape(kind, lv)
}
