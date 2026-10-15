import type { Stage, StagePhase, StageRegistry } from '@/trading/markets/stage'
import { ConfigError } from '@/core/errors'
import { STAGE_PHASES } from '@/trading/markets/stage'
import { createRegistrationPhase } from '@/trading/registry-lifecycle'

// Derived from STAGE_PHASES, so the tuple and the comparator cannot disagree on phase order.
// why-safe: Object.fromEntries widens the key type; the entries are exactly STAGE_PHASES.
const PHASE_RANK: Readonly<Record<StagePhase, number>> = Object.freeze(
  Object.fromEntries(STAGE_PHASES.map((phase, index) => [phase, index])) as Record<
    StagePhase,
    number
  >
)

export function createStageRegistry(): StageRegistry {
  const phase = createRegistrationPhase<Stage>('stage')

  return {
    register(stage) {
      if (stage.id.length === 0) {
        throw new ConfigError('stage has an empty id', undefined, ['stage'])
      }

      if (!Number.isFinite(stage.order)) {
        throw new ConfigError(`stage ${stage.id} has a non-finite order`, undefined, [
          'stage',
          stage.id,
        ])
      }

      phase.add(stage.id, stage)
    },
    close: phase.close,
    list: () => [...phase.entries()].sort(compareStages),
  }
}

// Phase rank, then order, then id: two stages sharing an order still run deterministically.
function compareStages(left: Stage, right: Stage): number {
  const byPhase = PHASE_RANK[left.phase] - PHASE_RANK[right.phase]

  if (byPhase !== 0) {
    return byPhase
  }

  return left.order === right.order ? left.id.localeCompare(right.id) : left.order - right.order
}
