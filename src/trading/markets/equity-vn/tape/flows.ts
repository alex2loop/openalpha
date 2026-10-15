import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { BarRecord, FlowSnapshot } from '@/trading/kernel/market/market-data'
import {
  FLOW_PERSISTENCE_MINIMUM_SESSIONS,
  FLOW_PERSISTENCE_SESSIONS,
} from '@/trading/markets/equity-vn/policy'

/** Both factor ratios read the same persistence window; it travels as data so the window a ratio
 *  was measured over is stated at the call site rather than assumed from a module constant. */
const FACTOR_FLOW_WINDOW: FlowWindow = Object.freeze({
  sessions: FLOW_PERSISTENCE_SESSIONS,
  minimumSessions: FLOW_PERSISTENCE_MINIMUM_SESSIONS,
})

interface AlignedFlow {
  readonly flow: FlowSnapshot
  readonly turnover: number
}

interface FlowWindow {
  readonly sessions: number
  readonly minimumSessions: number
}

/** Foreign and proprietary flow are the two factors most likely to be quietly wrong, because each
 *  divides one series by another with different coverage. Both ratios come from here. */
export function foreignFlowRatio(
  flows: readonly FlowSnapshot[],
  bars: readonly BarRecord[]
): number | undefined {
  return averageRatio(align(flows, bars), (flow) => flow.foreignNetValue, FACTOR_FLOW_WINDOW)
}

export function proprietaryFlowRatio(
  flows: readonly FlowSnapshot[],
  bars: readonly BarRecord[]
): number | undefined {
  return averageRatio(align(flows, bars), (flow) => flow.proprietaryNetValue, FACTOR_FLOW_WINDOW)
}

/** The newest session this leg reported, which need not be the newest the name traded: vndirect
 *  publishes the proprietary desk hours after the foreign one. */
export function newestFlowDay(
  flows: readonly FlowSnapshot[],
  pick: (flow: FlowSnapshot) => number | undefined
): TradingDay | undefined {
  return flows.findLast((flow) => pick(flow) !== undefined)?.at
}

/** Net foreign flow over the window, in the flows' own currency. The brief's desk-flow sections
 *  report this; they do not re-align or re-sum anything. */
export function netFlowValue(flows: readonly FlowSnapshot[], sessions: number): number {
  return sumOverWindow(flows, sessions, (flow) => flow.foreignNetValue)
}

/** `null` when no session in the window carries the figure: a source that never reports it must not
 *  read as a desk that traded nothing. */
export function proprietaryFlowValue(
  flows: readonly FlowSnapshot[],
  sessions: number
): number | null {
  const window = flows.slice(-sessions)

  return window.some((flow) => flow.proprietaryNetValue !== undefined)
    ? sumOverWindow(window, sessions, (flow) => flow.proprietaryNetValue)
    : null
}

/** One snapshot per session, summed across every name that reported one and carried under the
 *  instrument the caller names for the market. Proprietary net is present only where some name
 *  reported it: a desk no source covers must not read as one that traded nothing. */
export function marketFlowSnapshots(
  flows: readonly FlowSnapshot[],
  instrument: InstrumentRef
): readonly FlowSnapshot[] {
  const byDay = new Map<TradingDay, FlowSnapshot>()

  for (const flow of flows) {
    const total = byDay.get(flow.at)

    byDay.set(flow.at, total === undefined ? { ...flow, instrument } : addFlow(total, flow))
  }

  return [...byDay.values()].sort((left, right) => left.at.localeCompare(right.at))
}

function addFlow(total: FlowSnapshot, flow: FlowSnapshot): FlowSnapshot {
  const proprietaryNetValue = sumOptional(total.proprietaryNetValue, flow.proprietaryNetValue)

  return {
    ...total,
    fetchedAt: Math.max(total.fetchedAt, flow.fetchedAt),
    foreignBuyValue: total.foreignBuyValue + flow.foreignBuyValue,
    foreignSellValue: total.foreignSellValue + flow.foreignSellValue,
    foreignNetValue: total.foreignNetValue + flow.foreignNetValue,
    ...(proprietaryNetValue === undefined ? {} : { proprietaryNetValue }),
  }
}

function sumOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) {
    return right
  }

  return right === undefined ? left : left + right
}

function sumOverWindow(
  flows: readonly FlowSnapshot[],
  sessions: number,
  pick: (flow: FlowSnapshot) => number | undefined
): number {
  return flows.slice(-sessions).reduce((sum, flow) => {
    const value = pick(flow)

    return sum + (value !== undefined && Number.isFinite(value) ? value : 0)
  }, 0)
}

interface FlowShare {
  readonly day: TradingDay
  /** Foreign net traded over the session's turnover, signed. */
  readonly share: number
}

/** One share per aligned session, oldest first: the series the factor averages, exposed so a
 *  reader can ask about the newest session against the rest. */
export function foreignFlowShares(
  flows: readonly FlowSnapshot[],
  bars: readonly BarRecord[]
): readonly FlowShare[] {
  return align(flows, bars)
    .filter((entry) => isMeasurable(entry, entry.flow.foreignNetValue))
    .map((entry) => ({ day: entry.flow.at, share: entry.flow.foreignNetValue / entry.turnover }))
}

/** Alignment is by `TradingDay`, never by array index. A single missing flow session shifts every
 *  later pairing by one day, and the resulting ratio is plausible, stable, and wrong. A day with
 *  no turnover is dropped rather than treated as zero: dividing by zero is undefined, and calling
 *  it zero flow understates the signal. */
function align(flows: readonly FlowSnapshot[], bars: readonly BarRecord[]): readonly AlignedFlow[] {
  const turnoverByDay = new Map<TradingDay, number>()

  for (const bar of bars) {
    const turnover = bar.turnover ?? bar.candle.close * bar.candle.volume

    if (Number.isFinite(turnover) && turnover > 0) {
      turnoverByDay.set(bar.candle.at, turnover)
    }
  }

  const aligned: AlignedFlow[] = []

  for (const flow of flows) {
    const turnover = turnoverByDay.get(flow.at)

    if (turnover !== undefined) {
      aligned.push({ flow, turnover })
    }
  }

  return aligned
}

/** The window is the last N *aligned* entries, not the last N calendar days — otherwise a stretch
 *  of missing or zero-turnover sessions silently reaches further back than the name implies.
 *  Both operands are already VND, so the ratio is dimensionless; a future adapter that scaled flow
 *  to thousands would make this 1000x, which is why the adapters state the rule. */
function averageRatio(
  aligned: readonly AlignedFlow[],
  selectValue: (flow: FlowSnapshot) => number | undefined,
  window: FlowWindow
): number | undefined {
  const usable = aligned.filter((entry) => isMeasurable(entry, selectValue(entry.flow)))

  if (usable.length < window.minimumSessions) {
    return undefined
  }

  const recent = usable.slice(-window.sessions)
  const total = recent.reduce(
    (sum, entry) => sum + (selectValue(entry.flow) ?? 0) / entry.turnover,
    0
  )

  return total / recent.length
}

/** A desk's net cannot exceed the tape it traded on, so a session claiming otherwise is one the
 *  ratio cannot measure — the endpoints carry put-through that `turnover` excludes, and a desk row
 *  sometimes contradicts its own tape. Dropped rather than clamped: clamping invents a desk that
 *  traded the whole day, and an invented number ranks. */
function isMeasurable(entry: AlignedFlow, value: number | undefined): boolean {
  return value !== undefined && Number.isFinite(value) && Math.abs(value) <= entry.turnover
}
