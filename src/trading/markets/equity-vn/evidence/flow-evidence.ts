import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { FlowSnapshot, ProprietaryFlow } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { SourceRegistry } from '@/trading/markets/types'
import { available, dedupeProvenance } from '@/trading/kernel/source/source-result'
import { PROPRIETARY_LAG_TOLERANCE_SESSIONS } from '@/trading/markets/equity-vn/evidence/factor-staleness'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'

interface DayRange {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

interface FlowWindow extends DayRange {
  readonly instrument: InstrumentRef
  /** Sessions whose leg the caller already holds. The flows provider's answer never gains the
   *  session its desk endpoint skipped, so a day resolved once would otherwise reopen every pass. */
  readonly deskDays: ReadonlySet<TradingDay>
}

/** For a caller that stores nothing, so settles nothing to skip. */
export const NO_DESK_DAYS: ReadonlySet<TradingDay> = new Set()

/** Every flow reader goes through here, so the two desks are assembled once rather than once per
 *  caller. The flows provider publishes the foreign desk within the session and the proprietary one
 *  later, so the second provider is asked only for the sessions still missing that leg. */
export async function readFlows(
  sources: SourceRegistry,
  window: FlowWindow,
  signal: AbortSignal
): Promise<SourceResult<readonly FlowSnapshot[]>> {
  const flows = await sources.resolve({
    kind: 'flows',
    context: {
      market: VN_MARKET_REF,
      instrument: window.instrument,
      fromDay: window.fromDay,
      toDay: window.toDay,
    },
    signal,
  })

  if (flows.kind === 'unavailable') {
    return flows
  }

  const gap = fillableGap(flows.value, window.deskDays)

  if (gap === undefined) {
    return flows
  }

  // `resolveAll` rather than `resolve`: failover flattens an answer of no rows into a failure, and
  // here that answer is the fact worth having — a desk that traded nothing closes the gap.
  const [desk] = await sources.resolveAll({
    kind: 'proprietaryFlows',
    context: { market: VN_MARKET_REF, instrument: window.instrument, ...gap },
    signal,
  })

  if (desk === undefined || desk.kind === 'unavailable') {
    return { ...flows, caveats: [...flows.caveats, ...providerFailures(desk?.caveats ?? [])] }
  }

  return available(
    withProprietaryLeg(flows.value, desk.value, gap),
    dedupeProvenance([...flows.provenance, ...desk.provenance]),
    [...flows.caveats, ...desk.caveats]
  )
}

/** An empty window is a fact about the session, not the provider. Everything else — a timeout, an
 *  open breaker, a refused payload — is the provider down, and silence there reads as a quiet
 *  session. */
function providerFailures(caveats: readonly Caveat[]): readonly Caveat[] {
  return caveats.filter((caveat) => caveat.code !== 'source.empty-window')
}

/** The sessions worth asking the desk provider for, as one range: the ones whose leg the flows
 *  provider never reached, less the newest of the window. The desk publishes after the close, so
 *  those are unset at every provider and asking sweeps the board for a leg nobody holds yet. The
 *  exclusion is by session rather than by position in the missing list, so a newer session already
 *  held cannot hide an older one that is not. */
function fillableGap(
  flows: readonly FlowSnapshot[],
  deskDays: ReadonlySet<TradingDay>
): DayRange | undefined {
  const days = flows.map((flow) => flow.at).sort()
  const unpublished = new Set(days.slice(days.length - PROPRIETARY_LAG_TOLERANCE_SESSIONS))
  const fillable = flows
    .flatMap((flow) => (flow.proprietaryNetValue === undefined ? [flow.at] : []))
    .filter((day) => !(deskDays.has(day) || unpublished.has(day)))
    .sort()
  const fromDay = fillable[0]
  const toDay = fillable[fillable.length - 1]

  return fromDay === undefined || toDay === undefined ? undefined : { fromDay, toDay }
}

/** The filled snapshot keeps the flows provider's stamp, the way a merged gold board keeps its
 *  first vendor's, and both providers travel on the result's provenance. A session inside
 *  `answered` with no row against it is a desk that did not trade the name — a real zero, the same
 *  reading the flows provider's own adapter takes of its covered days, and what stops the session
 *  falling back into the next gap. A row whose figure was withheld is left unset instead: the desk
 *  did trade, and a fabricated flat session would dilute the average the leg feeds. */
function withProprietaryLeg(
  flows: readonly FlowSnapshot[],
  desk: readonly ProprietaryFlow[],
  answered: DayRange
): readonly FlowSnapshot[] {
  const deskByDay = new Map(desk.map((entry) => [entry.at, entry]))

  return flows.map((flow) => {
    if (flow.proprietaryNetValue !== undefined || !isDayInRange(flow.at, answered)) {
      return flow
    }

    const entry = deskByDay.get(flow.at)

    if (entry === undefined) {
      return { ...flow, proprietaryNetValue: 0 }
    }

    return entry.netValue === undefined || entry.currency !== flow.currency
      ? flow
      : { ...flow, proprietaryNetValue: entry.netValue }
  })
}

function isDayInRange(day: TradingDay, range: DayRange): boolean {
  return day >= range.fromDay && day <= range.toDay
}
