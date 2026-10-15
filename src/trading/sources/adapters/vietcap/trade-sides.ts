import { z } from 'zod'

import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { DailyTradeSides } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { VIETCAP_ID } from '@/trading/sources/adapters/vietcap/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dayFromEpochSeconds, parseRow } from '@/trading/sources/rows/normalization'

const TRADE_SIDES_PATH = '/api/market-watch/LEData/getAll'
/** The provider truncates a page at this many rows whatever `limit` asks for. */
const TRADE_SIDES_PAGE_SIZE = 100
/** Pages one reconstruction will chase, newest first. The host stops answering after roughly twenty
 *  consecutive pages at any pace, so this stays well inside that. A name whose session does not fit
 *  reports nothing rather than the part that did: a stored reading has to mean the same thing
 *  whichever source answered it. */
const TRADE_SIDES_MAXIMUM_PAGES = 8
/** The provider's aggressor tags. Anything else is an auction print or a classification it
 *  declined to make, and is counted as neither side. */
const BUY_MATCH = 'b'
const SELL_MATCH = 's'
/** Share counts arrive as decimal strings, so a lost row shows up as a fractional mismatch rather
 *  than a whole one. A share is indivisible on this board, so anything under one is rounding. */
const VOLUME_TOLERANCE = 1
/** The board these matches print on, so a `truncTime` epoch resolves to the session that traded
 *  it rather than to the reader's day. */
const VN_TIMEZONE = 'Asia/Ho_Chi_Minh'

/** `id` is the sequence, not `truncTime`: the timestamp is truncated to the second and one second
 *  carries up to ten matches, under which `accumulatedVolume` is not monotonic. Ordering by it
 *  would pick an arbitrary member of the newest group as the newest row. */
const TRADE_SIDES_ROW = z.object({
  id: z.coerce.number().finite(),
  truncTime: z.string().min(1),
  matchType: z.string().min(1),
  matchVol: z.coerce.number().finite().nonnegative(),
  accumulatedVolume: z.coerce.number().finite().nonnegative(),
})

type TradeSidesMatch = z.infer<typeof TRADE_SIDES_ROW>

/** Instrument-scoped and settled-session only: a ratio taken mid-session is a sample of whatever
 *  has traded so far, and it flips often enough that acting on one is worse than having none. */
export function tradeSidesSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VIETCAP_ID,
    kind: 'tradeSides',
    http: options.http,
    covers: (context: SourceContext) =>
      context.instrument !== undefined && context.toDay !== undefined,
    load: (context, signal) => loadTradeSides(options.http, context, signal),
  })
}

async function loadTradeSides(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<DailyTradeSides>>> {
  const { instrument, toDay } = context

  if (instrument === undefined || toDay === undefined) {
    throw new ValidationError('trade sides request carries no instrument or day')
  }

  const matches = new Map<number, TradeSidesMatch>()
  let cursor: string | null = null
  let fetchedAt = 0
  let complete = false

  for (let page = 0; page < TRADE_SIDES_MAXIMUM_PAGES; page++) {
    const outcome = await http.postJson(
      {
        sourceId: VIETCAP_ID,
        path: TRADE_SIDES_PATH,
        jsonBody: { symbol: instrument.ticker, limit: TRADE_SIDES_PAGE_SIZE, truncTime: cursor },
        signal,
      },
      (raw) => toMatches(raw)
    )

    if (outcome.kind === 'error') {
      return outcome
    }

    fetchedAt = outcome.fetchedAt

    for (const match of outcome.value) {
      matches.set(match.id, match)
    }

    if (outcome.value.length < TRADE_SIDES_PAGE_SIZE) {
      complete = true
      break
    }

    cursor = oldestCursor(outcome.value)
  }

  if (!complete) {
    return { kind: 'error', code: 'source.truncated' }
  }

  return toTradeSidesOutcome({ matches: [...matches.values()], instrument, toDay, fetchedAt })
}

interface TradeSidesTally {
  readonly matches: readonly TradeSidesMatch[]
  readonly instrument: InstrumentRef
  readonly toDay: TradingDay
  readonly fetchedAt: number
}

/** The endpoints state how much volume the reconstruction should span: the newest row's running
 *  total, less everything that had traded before the oldest. Falling short means a page was lost in
 *  the middle, and a ratio taken across a gap leans toward whichever side survived. */
function toTradeSidesOutcome(
  tally: TradeSidesTally
): SourceFetchOutcome<ParsedSource<DailyTradeSides>> {
  const ordered = [...tally.matches].sort((left, right) => left.id - right.id)
  const oldest = ordered[0]
  const newest = ordered[ordered.length - 1]

  if (oldest === undefined || newest === undefined) {
    return { kind: 'error', code: 'source.empty-window' }
  }

  const buyVolume = sumMatched(ordered, BUY_MATCH)
  const sellVolume = sumMatched(ordered, SELL_MATCH)
  const total = ordered.reduce((sum, match) => sum + match.matchVol, 0)
  const spanned = newest.accumulatedVolume - (oldest.accumulatedVolume - oldest.matchVol)

  if (Math.abs(total - spanned) > VOLUME_TOLERANCE) {
    return { kind: 'error', code: 'source.payload-rejected' }
  }

  // The request carries no day, so the reply is whatever session the tape holds. Stamping it with
  // the day that was asked for is how a stale tape becomes a settled row nothing revisits.
  if (dayFromEpochSeconds(Number(newest.truncTime), VN_TIMEZONE) !== tally.toDay) {
    return { kind: 'error', code: 'source.stale-window' }
  }

  return {
    kind: 'ok',
    fetchedAt: tally.fetchedAt,
    value: parsedSource(
      {
        instrument: tally.instrument,
        at: tally.toDay,
        buyVolume,
        sellVolume,
        auctionVolume: total - buyVolume - sellVolume,
        sourceId: VIETCAP_ID,
        fetchedAt: tally.fetchedAt,
      },
      []
    ),
  }
}

function sumMatched(matches: readonly TradeSidesMatch[], tag: string): number {
  return matches.reduce((sum, match) => (match.matchType === tag ? sum + match.matchVol : sum), 0)
}

/** The next page starts strictly before this timestamp. `truncTime` is truncated to the second, so
 *  a page routinely ends part-way through a group sharing one second; stopping at that second would
 *  skip the rest of it. Stepping back to the next distinct timestamp re-reads the group whole - the
 *  id-keyed map absorbs the repeats, and the cursor still moves strictly older. A page whose rows
 *  all share one timestamp has no boundary to step back to, and the span check rejects what that
 *  loses. */
function oldestCursor(matches: readonly TradeSidesMatch[]): string | null {
  const times = matches.map((match) => match.truncTime)
  const oldest = times.reduce((best, time) => (time < best ? time : best), times[0] ?? '')

  if (oldest === '') {
    return null
  }

  const above = times.filter((time) => time > oldest)

  return above.length === 0 ? oldest : above.reduce((best, time) => (time < best ? time : best))
}

/** A malformed row costs the whole session, not just itself: the total is checked against the
 *  provider's own running count, and a silently dropped row would fail that check anyway. */
function toMatches(raw: unknown): readonly TradeSidesMatch[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('vietcap trade sides payload is not an array')
  }

  return raw.map((row) => parseRow(TRADE_SIDES_ROW, row, 'vietcap trade sides'))
}
