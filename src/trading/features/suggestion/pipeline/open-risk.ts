import type {
  OpenRisk,
  SuggestionPortfolioContext,
} from '@/trading/features/suggestion/pipeline/types'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import { heldPositionOf } from '@/trading/features/suggestion/pipeline/concentration'
import { planStopOf } from '@/trading/features/suggestion/types'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { isBelowMinimumSize } from '@/trading/kernel/venue/catalog'

/** What the read of a held name's plan needs: the store and the caller's cancellation. */
interface OpenRiskReader {
  readonly store: Pick<SuggestionStore, 'findLatestExitPlan'>
  readonly signal: AbortSignal
}

/** Summed over priced, tradeable holdings against the stop each one's latest exit plan names. Absent
 *  without a NAV to be a share of. The plan is read once per instrument, however many venues hold
 *  it, and an unplanned name is listed on that first read, so the count is per name. */
export async function openRiskOf(
  reader: OpenRiskReader,
  context: SuggestionPortfolioContext
): Promise<OpenRisk | undefined> {
  const navBase = context.book.navBase

  if (navBase === undefined || navBase <= 0) {
    return undefined
  }

  const stops = new Map<string, number | undefined>()
  const unplanned: InstrumentRef[] = []
  let riskBase = 0

  for (const valued of context.book.positions) {
    if (valued.kind !== 'priced' || valued.price <= 0) {
      continue
    }

    const { instrument, quantity } = valued.position
    const key = buildInstrumentKey(instrument)

    if (isBelowMinimumSize(quantity, context.minimumSizes.get(key))) {
      continue
    }

    if (!stops.has(key)) {
      const planned = await plannedStop(reader, {
        instrument,
        mark: valued.price,
        heldSince: heldPositionOf(context, instrument)?.openedOn,
      })
      stops.set(key, planned)

      if (planned === undefined) {
        unplanned.push(instrument)
      }
    }

    const stop = stops.get(key)

    if (stop === undefined) {
      continue
    }

    // The stop is quoted in the market's own currency, as the mark is; the ratio converts it at the
    // same rate the valuation already used rather than asking for an FX read of its own.
    riskBase += quantity * Math.max(valued.price - stop, 0) * (valued.priceBase / valued.price)
  }

  return { pctNav: riskBase / navBase, unplanned }
}

/** The stop is the one the tick has trailed it to, as every other surface reads it. Only a
 *  long-framed plan is offered at all — `findLatestExitPlan` owns that. */
async function plannedStop(
  reader: OpenRiskReader,
  held: {
    readonly instrument: InstrumentRef
    readonly mark: number
    readonly heldSince: TradingDay | undefined
  }
): Promise<number | undefined> {
  const { instrument, mark, heldSince } = held
  const plan = await reader.store.findLatestExitPlan({
    market: instrument.market,
    ticker: instrument.ticker,
    ...(heldSince === undefined ? {} : { heldSince }),
    signal: reader.signal,
  })

  if (plan === null) {
    return undefined
  }

  const stop = planStopOf(plan)

  // A stop at or above the mark is breached, not protective: the name counts as unplanned.
  return stop === undefined || stop >= mark ? undefined : stop
}
