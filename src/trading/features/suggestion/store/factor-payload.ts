import type {
  FactorMetricPayload,
  FactorResultPayload,
} from '@/trading/features/suggestion/store/suggestion-payload'
import type { FactorResult } from '@/trading/kernel/factor'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import { definedOnly } from '@/core/utils/collections'
import { toProvenance } from '@/trading/kernel/store/store-payload'

export function toFactorResultPayload(factor: FactorResult): FactorResultPayload {
  return {
    id: factor.id,
    score: factor.score,
    weight: factor.weight,
    metrics: factor.metrics,
    provenance: [...factor.provenance],
    caveats: [...factor.caveats],
  }
}

export function toFactorResult(raw: FactorResultPayload): FactorResult {
  return {
    id: raw.id,
    score: raw.score,
    ...definedOnly({ weight: raw.weight }),
    ...(raw.metrics === undefined ? {} : { metrics: raw.metrics.map(toFactorMetric) }),
    provenance: raw.provenance.map(toProvenance),
    caveats: raw.caveats,
  }
}

function toFactorMetric(raw: FactorMetricPayload): FactorMetric {
  return {
    id: raw.id,
    value: raw.value,
    ...definedOnly({ sessions: raw.sessions }),
  }
}
