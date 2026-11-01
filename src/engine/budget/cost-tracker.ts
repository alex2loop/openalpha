import type { PriceSource, Pricing } from '@/ai/api'
import type { ProviderModelId } from '@/core/llm'
import type { TokenUsage } from '@/core/stream-events'
import type { CostSource } from '@/core/types/usage'
import type {
  CostCharge,
  CostReservation,
  CostTracker,
  CostTrackerSnapshot,
} from '@/engine/types/cost'
import { cacheRatesOf } from '@/ai/api'
import { ConfigError } from '@/core/errors'
import { dayBoundsInZone, monthBoundsInZone } from '@/core/utils/time'
import { isPositiveFinite, normalizeActualUsd, normalizeUsd } from '@/engine/budget/run-budget'

const TOKENS_PER_PRICE_UNIT = 1_000_000

interface ProviderReportedUsage extends TokenUsage {
  readonly costUsd: number
}

interface ResolvedCharge {
  readonly costUsd: number
  readonly costSource: CostSource
}

// Starts at zero; boot hydrates day/month totals from the store. Callers release each
// reservation exactly once in `finally`.
export function createCostTracker(options: {
  readonly pricing: Pricing
  readonly maxDailyUsd: number
  readonly maxMonthlyUsd: number
  readonly timeZone: string
}): CostTracker {
  return new RunCostTracker(options)
}

class RunCostTracker implements CostTracker {
  private readonly maxDailyUsd: number
  private readonly maxMonthlyUsd: number
  private readonly pricing: Pricing
  // Must match the calendar the persisted totals are summed over, or a rehydrated total covers a
  // different span than the one the tracker is accruing into.
  private readonly timeZone: string
  private dailyWarnedValue = false
  private monthlyWarnedValue = false
  private dailyExhaustedValue = false
  private monthlyExhaustedValue = false
  private ledgerUnavailableValue = false
  private dailySpentValue = 0
  private monthlySpentValue = 0
  private reservedValue = 0
  private dayStartMs = 0
  private monthStartMs = 0

  constructor(options: {
    readonly pricing: Pricing
    readonly maxDailyUsd: number
    readonly maxMonthlyUsd: number
    readonly timeZone: string
  }) {
    this.pricing = options.pricing
    this.maxDailyUsd = normalizeUsd(options.maxDailyUsd)
    this.maxMonthlyUsd = normalizeUsd(options.maxMonthlyUsd)
    this.timeZone = options.timeZone
  }

  hydrate(totals: {
    readonly dayUsd: number
    readonly monthUsd: number
    readonly at: number
  }): void {
    this.rollover(totals.at)
    this.dailySpentValue = normalizeUsd(totals.dayUsd)
    this.monthlySpentValue = normalizeUsd(totals.monthUsd)
  }

  snapshot(at: number): CostTrackerSnapshot {
    this.rollover(at)

    return {
      dailySpentUsd: this.dailySpentValue,
      monthlySpentUsd: this.monthlySpentValue,
      reservedUsd: this.reservedValue,
      dailyWarned: this.dailyWarnedValue,
      monthlyWarned: this.monthlyWarnedValue,
      dailyCapUsd: this.maxDailyUsd,
      monthlyCapUsd: this.maxMonthlyUsd,
      ledgerUnavailable: this.ledgerUnavailableValue,
    }
  }

  // One-way: the in-memory totals stay conservative, but a restart would rehydrate from a ledger
  // that is missing this spend, so no further paid work is admitted in this process.
  markLedgerUnavailable(): void {
    this.ledgerUnavailableValue = true
  }

  markWarned(period: 'daily' | 'monthly', at: number): void {
    this.rollover(at)

    if (period === 'daily') {
      this.dailyWarnedValue = true
      return
    }

    this.monthlyWarnedValue = true
  }

  markExhausted(period: 'daily' | 'monthly', at: number): boolean {
    this.rollover(at)

    if (period === 'daily') {
      const first = !this.dailyExhaustedValue
      this.dailyExhaustedValue = true

      return first
    }

    const first = !this.monthlyExhaustedValue
    this.monthlyExhaustedValue = true

    return first
  }

  reserve(estimateUsd: number): CostReservation {
    let remainingUsd = isPositiveFinite(estimateUsd) ? estimateUsd : 0
    this.reservedValue += remainingUsd
    let released = false

    return {
      consume: (actualUsd: number): void => {
        if (released) {
          return
        }

        const consumed = Math.min(remainingUsd, normalizeActualUsd(actualUsd))
        remainingUsd -= consumed
        this.reservedValue = Math.max(0, this.reservedValue - consumed)
      },
      release: (): void => {
        if (released) {
          return
        }

        released = true
        this.reservedValue = Math.max(0, this.reservedValue - remainingUsd)
        remainingUsd = 0
      },
    }
  }

  record(id: ProviderModelId, usage: TokenUsage, settledAt: number): CostCharge {
    const charge = recordCharge(this.pricing, id, usage)

    if (!Number.isFinite(charge.costUsd) || charge.costUsd < 0) {
      throw new ConfigError('non-finite cost rejected by accounting', undefined, ['cost'])
    }

    this.rollover(settledAt)
    this.dailySpentValue += charge.costUsd
    this.monthlySpentValue += charge.costUsd

    const exceededCap = resolveExceededCap({
      dailySpent: this.dailySpentValue,
      dailyCap: this.maxDailyUsd,
      monthlySpent: this.monthlySpentValue,
      monthlyCap: this.maxMonthlyUsd,
    })

    return {
      ...charge,
      ...(exceededCap === undefined ? {} : { exceededCap }),
    }
  }

  // Periods only ever advance. Comparing period starts rather than testing them for inequality is
  // what makes a backwards wall clock (NTP) safe: an `at` behind the current period is attributed
  // to it, where an inequality test would zero the totals and hand a cap's worth of spend back
  // inside one real day.
  private rollover(at: number): void {
    const dayStartMs = dayBoundsInZone(at, this.timeZone).fromMs
    const monthStartMs = monthBoundsInZone(at, this.timeZone).fromMs

    if (dayStartMs > this.dayStartMs) {
      this.dailySpentValue = 0
      this.dayStartMs = dayStartMs
      this.dailyWarnedValue = false
      this.dailyExhaustedValue = false
    }

    if (monthStartMs > this.monthStartMs) {
      this.monthlySpentValue = 0
      this.monthStartMs = monthStartMs
      this.monthlyWarnedValue = false
      this.monthlyExhaustedValue = false
    }
  }
}

// Uncached input, output, cache-read, and cache-write are priced exactly once. Reasoning is a
// subset of billed output (adapters keep it there), so it is persisted for visibility but never
// added again; cache reads are priced apart from uncached input, which adapters pre-subtract.
function recordCharge(pricing: Pricing, id: ProviderModelId, usage: TokenUsage): ResolvedCharge {
  if (hasProviderReportedCost(usage)) {
    return { costUsd: usage.costUsd, costSource: 'provider_reported' }
  }

  const { price, source } = pricing.priceOf(id)
  const cache = cacheRatesOf(price)
  const tokens =
    usage.input * price.inPerM +
    usage.output * price.outPerM +
    (usage.cacheRead ?? 0) * cache.readPerM +
    (usage.cacheWrite ?? 0) * cache.writePerM

  return {
    costUsd: tokens / TOKENS_PER_PRICE_UNIT,
    costSource: toCostSource(source),
  }
}

function toCostSource(source: PriceSource): CostSource {
  switch (source) {
    case 'override':
      return 'pricing_override'
    case 'subscription':
      return 'pricing_subscription'
    case 'openrouter':
      return 'pricing_openrouter'
    case 'models.dev':
      return 'pricing_modelsdev'
    case 'local':
      return 'pricing_local'
    case 'fallback':
      return 'pricing_fallback'
    default: {
      const exhaustive: never = source
      throw new ConfigError(`unhandled price source: ${String(exhaustive)}`)
    }
  }
}

function resolveExceededCap(input: {
  readonly dailySpent: number
  readonly dailyCap: number
  readonly monthlySpent: number
  readonly monthlyCap: number
}): CostCharge['exceededCap'] {
  if (input.dailyCap > 0 && input.dailySpent > input.dailyCap) {
    return 'daily'
  }

  if (input.monthlyCap > 0 && input.monthlySpent > input.monthlyCap) {
    return 'monthly'
  }

  return undefined
}

function hasProviderReportedCost(usage: TokenUsage): usage is ProviderReportedUsage {
  return (
    'costUsd' in usage &&
    typeof usage.costUsd === 'number' &&
    Number.isFinite(usage.costUsd) &&
    usage.costUsd >= 0
  )
}
