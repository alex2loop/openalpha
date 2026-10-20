import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle, FlowSnapshot } from '@/trading/kernel/market/market-data'
import type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { StoryRead } from '@/trading/kernel/operator/brief-story'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import type { StoryInputs } from '@/trading/markets/equity-vn/brief/story-facts'
import type { CrossSection, NameEvidence } from '@/trading/markets/equity-vn/factors/factors'
import { isAbortError } from '@/core/errors'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import { VN_STORY_DETECTORS } from '@/trading/markets/equity-vn/brief/story-detectors'
import { vnRows } from '@/trading/markets/equity-vn/brief/story-facts'
import { VN_STORY_POLICY } from '@/trading/markets/equity-vn/brief/story-policy'
import { latestBarProvenance } from '@/trading/markets/equity-vn/evidence/provenance'
import { latestNameSession } from '@/trading/markets/equity-vn/factors/factors'
import {
  FLOW_DEVIATION_SESSIONS,
  VN30_INDEX_TICKER,
  VN100_INDEX_TICKER,
} from '@/trading/markets/equity-vn/policy'
import { breadthAt } from '@/trading/markets/equity-vn/tape/breadth'
import {
  sessionForeignNet,
  sessionTotal,
  sessionTurnoverTotal,
  toTurnoverRatio,
  toTurnoverReference,
} from '@/trading/markets/equity-vn/tape/session-totals'
import { rangeFromCloses } from '@/trading/markets/overview'
import { rowMoveIn } from '@/trading/markets/overview-sections'

const PERCENT_PER_UNIT = 100
const UNREAD: StoryRead = Object.freeze({ kind: 'unread' })

interface StorySource {
  readonly context: BriefContext
  readonly cross: CrossSection
  readonly vn: MarketDataOverview
  readonly sections: readonly BriefSectionResult[]
}

/** A throw costs the brief its story and nothing else; `features/brief` logs the `failed` arm. An
 *  abort is the caller's to see. */
export function tryReadStories(
  context: BriefContext,
  sections: readonly BriefSectionResult[],
  vn: MarketDataOverview | undefined
): StoryRead {
  try {
    return readVnStories(context, sections, vn)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return { kind: 'failed', err }
  }
}

/** The only caller of the detectors. A story follows the market's own overview: without it the
 *  market is switched off, and with a gate input missing no detector could have fired, so a quiet
 *  day would claim a reading that never happened. Both are `unread`, which prints nothing. */
function readVnStories(
  context: BriefContext,
  sections: readonly BriefSectionResult[],
  vn: MarketDataOverview | undefined
): StoryRead {
  const cross = context.cross

  if (vn === undefined || cross === null) {
    return UNREAD
  }

  const inputs = buildInputs({ context, cross, vn, sections })

  if (inputs === undefined) {
    return UNREAD
  }

  const { range } = inputs

  return {
    kind: 'read',
    session: inputs.session,
    currency: vn.currency,
    ...(range === undefined
      ? {}
      : { levels: { supportPct: range.supportPct, resistancePct: range.resistancePct } }),
    candidates: VN_STORY_DETECTORS.flatMap((detect) => detect(inputs) ?? []),
    provenance: storyProvenance(cross.names, inputs),
  }
}

/** Settled-session values only. The session is the names' own newest day, and the index must reach
 *  it with a bar before it, or its move would be one session's price under another's date. */
function buildInputs(source: StorySource): StoryInputs | undefined {
  const { context, cross, vn, sections } = source
  const session = latestNameSession(cross.names)

  if (session === undefined) {
    return undefined
  }

  const indexMovePct = indexMoveThrough(cross.indexBars, session)
  const breadth = breadthAt(cross.names, session, cross.indexBars)
  const aboveMa50Ratio = breadth?.aboveMa50Ratio

  if (indexMovePct === undefined || breadth === undefined || aboveMa50Ratio === undefined) {
    return undefined
  }

  const earlier = context.calendar.addTradingDays(session, -VN_STORY_POLICY.breadthShiftSessions)
  const breadthBefore = breadthAt(cross.names, earlier, cross.indexBars)
  const range = rangeFromCloses(closesThrough(cross.indexBars, session))
  const basis = basisDatedAt(source, session)

  return Object.freeze({
    session,
    indexMovePct,
    ...moveInputs(vn, session),
    breadth: { ...breadth, aboveMa50Ratio },
    ...(breadthBefore === undefined ? {} : { breadthBefore }),
    ...turnoverInputs(cross.names, session),
    ...flowInputs(sections, cross.names, session),
    ...(range === undefined ? {} : { range }),
    ...(basis === undefined ? {} : { basis }),
    sections,
  })
}

/** Between the last two index closes through `session`, in percent. Absent unless the series ends
 *  on `session` itself. */
function indexMoveThrough(bars: readonly Candle[], session: TradingDay): number | undefined {
  const through = bars.filter((bar) => bar.at <= session)
  const last = through[through.length - 1]
  const previous = through[through.length - 2]

  if (last === undefined || last.at !== session || previous === undefined || previous.close <= 0) {
    return undefined
  }

  return (last.close / previous.close - 1) * PERCENT_PER_UNIT
}

function closesThrough(bars: readonly Candle[], session: TradingDay): readonly number[] {
  return bars.filter((bar) => bar.at <= session).map((bar) => bar.close)
}

/** The two wider indexes by `rowMoveIn`, which reads a row's move in this session and nothing a
 *  live reading says about the next. */
function moveInputs(
  vn: MarketDataOverview,
  session: TradingDay
): Pick<StoryInputs, 'vn30MovePct' | 'vn100MovePct'> {
  const vn30MovePct = moveOfIndex(vn, VN30_INDEX_TICKER, session)
  const vn100MovePct = moveOfIndex(vn, VN100_INDEX_TICKER, session)

  return {
    ...(vn30MovePct === undefined ? {} : { vn30MovePct }),
    ...(vn100MovePct === undefined ? {} : { vn100MovePct }),
  }
}

function moveOfIndex(
  vn: MarketDataOverview,
  index: string,
  session: TradingDay
): number | undefined {
  const row = vn.rows.find((candidate) => candidate.instrument.ticker === index)

  return row === undefined ? undefined : rowMoveIn(row, session)
}

/** `windowTurnover` is the reference mean times the window the foreign desks are summed over, so a
 *  net flow is compared with the turnover of the same span. */
function turnoverInputs(
  names: readonly NameEvidence[],
  session: TradingDay
): Pick<StoryInputs, 'turnoverRatio' | 'turnoverSessions' | 'windowTurnover'> {
  const reference = toTurnoverReference(names, session)
  const turnoverRatio = toTurnoverRatio(sessionTurnoverTotal(names, session), reference)

  return {
    ...(turnoverRatio === undefined ? {} : { turnoverRatio }),
    ...(reference === undefined
      ? {}
      : {
          turnoverSessions: reference.sessions,
          windowTurnover: reference.value * FLOW_DEVIATION_SESSIONS,
        }),
  }
}

/** The window net is the foreign section's total row, and counts only when the flows reach the
 *  session: a window ending earlier is another day's story. */
function flowInputs(
  sections: readonly BriefSectionResult[],
  names: readonly NameEvidence[],
  session: TradingDay
): Pick<StoryInputs, 'windowForeignNet' | 'sessionForeignNet'> {
  const sessionNet = sessionTotal(names, session, sessionForeignNet)
  const [total] = vnRows(sections, 'foreign-desk-flow')
  const windowNet = total?.net

  if (sessionNet === undefined || typeof windowNet !== 'number') {
    return {}
  }

  return { windowForeignNet: windowNet, sessionForeignNet: sessionNet }
}

function basisDatedAt(source: StorySource, session: TradingDay): StoryInputs['basis'] {
  const [row] = vnRows(source.sections, 'basis')

  return row !== undefined && (row.closedOn ?? source.context.request.asOf) === session
    ? row
    : undefined
}

function storyProvenance(
  names: readonly NameEvidence[],
  inputs: StoryInputs
): readonly SourceProvenance[] {
  const flows =
    inputs.windowForeignNet === undefined ? [] : names.flatMap((name) => flowStamp(name, inputs))

  return dedupeProvenance([...names.flatMap(latestBarProvenance), ...flows])
}

function flowStamp(name: NameEvidence, inputs: StoryInputs): readonly SourceProvenance[] {
  const last: FlowSnapshot | undefined = name.flows[name.flows.length - 1]

  if (last === undefined || last.at !== inputs.session) {
    return []
  }

  return [{ sourceId: last.sourceId, fetchedAt: last.fetchedAt, freshness: 'cached' }]
}
