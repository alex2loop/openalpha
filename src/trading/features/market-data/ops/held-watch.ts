import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type {
  InstrumentHeadline,
  NewsArchiveStore,
} from '@/trading/features/market-data/store/news-archive'
import type { InstrumentRef, MarketRef, Region, TradingDay } from '@/trading/kernel/instrument'
import type { QuoteBoard } from '@/trading/kernel/market/market-capability'
import type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
import type { StopDistance } from '@/trading/kernel/operator/alert'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { TradingNotice, TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { buildInstrumentKey, dedupeInstruments } from '@/trading/kernel/instrument'
import { stopStandingOf } from '@/trading/kernel/operator/alert'
import { sendCaught } from '@/trading/kernel/operator/delivery-retry'
import { sessionPhase } from '@/trading/markets/calendar'
import { registrableDomain } from '@/trading/markets/news'
import { rowMoveIn } from '@/trading/markets/overview-sections'
import { quoteBoardMoveOf } from '@/trading/render/price-pair'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

/** The region's index falling this far, in percent, in a session is worth the operator's attention. */
const INDEX_DROP_PCT = 1.5
/** How often the index is read while its session runs: a drop is a minutes-scale event, and the
 *  read builds a market overview. */
const INDEX_CHECK_INTERVAL_MS = 5 * MS_PER_MINUTE
/** Bounds what one pass reads of the archive; a pass is a minute long and the book is small. */
const HELD_NEWS_LIMIT = 100

interface HeldWatchReads {
  tradeableHoldingsAt(options: {
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<readonly { readonly instrument: InstrumentRef }[]>
  overview(options: {
    readonly now: number
    readonly signal: AbortSignal
    readonly markets: readonly MarketRef[]
  }): Promise<readonly MarketDataOverview[]>
  quoteBoard(options: {
    readonly instruments: readonly InstrumentRef[]
    readonly signal: AbortSignal
  }): Promise<QuoteBoard>
  stopDistances(options: {
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<readonly StopDistance[]>
}

interface HeldWatchDeps {
  readonly markets: MarketRegistry
  /** The region the book is read in: its owner's calendar dates the day and its benchmark is the
   *  index. */
  readonly region: Region
  readonly reads: HeldWatchReads
  readonly news: Pick<NewsArchiveStore, 'listForInstruments'>
  readonly sender: TradingNoticeSender
  recipient(): DeliveryAddress | undefined
  readonly locale: Locale
  readonly logger: Logger
}

/** One pass of the held-name watch. Told once a minute by the alerts loop. */
export type HeldWatch = (signal: AbortSignal) => Promise<void>

/** What the watch has already said, for the day it is in. All of it is dropped at the day change,
 *  so none of it grows past one day's held names. */
interface WatchState {
  /** The instant the archive was last read to: only stories archived since it are news. Starts at
   *  boot, so a restart does not repeat the day's headlines. */
  cursor: number
  day: TradingDay | undefined
  /** Held names already told about today, by instrument key. */
  readonly newsSent: Set<string>
  indexCheckedAt: number
  indexDropSent: boolean
}

interface PassInput {
  readonly now: number
  readonly target: DeliveryAddress
  readonly signal: AbortSignal
}

/** Tells the operator, through the bell, when a name they hold is written about and when the
 *  region's index falls hard. It only reads and sends; it never acts on the book. A pass that
 *  fails is logged once until one succeeds, and never fails the loop that calls it. */
export function createHeldWatch(deps: HeldWatchDeps): HeldWatch {
  const state: WatchState = {
    cursor: Date.now(),
    day: undefined,
    newsSent: new Set(),
    indexCheckedAt: 0,
    indexDropSent: false,
  }
  let failureLogged = false

  return async (signal) => {
    try {
      await watchOnce(deps, state, signal)
      failureLogged = false
    } catch (err: unknown) {
      if (isAbortError(err) || signal.aborted) {
        throw err
      }

      if (!failureLogged) {
        failureLogged = true
        deps.logger.warn('trading.held_watch_failed', { err: formatErrForLog(err) })
      }
    }
  }
}

async function watchOnce(
  deps: HeldWatchDeps,
  state: WatchState,
  signal: AbortSignal
): Promise<void> {
  const now = Date.now()
  const owner = deps.markets.regionOwner(deps.region)
  const target = deps.recipient()

  // Nobody to tell: what was archived meanwhile is not news when someone is listening again.
  if (owner === null || target === undefined) {
    state.cursor = now

    return
  }

  rollDay(state, owner.manifest.calendar.dayAt(now))

  const held = dedupeInstruments(
    (await deps.reads.tradeableHoldingsAt({ now, signal })).map((holding) => holding.instrument)
  )

  if (held.length === 0) {
    state.cursor = now

    return
  }

  const headlines = await deps.news.listForInstruments({
    instruments: held,
    sinceMs: state.cursor,
    limit: HELD_NEWS_LIMIT,
    signal,
  })

  state.cursor = now

  const input: PassInput = { now, target, signal }

  await sendHeldNews(deps, state, { ...input, headlines })
  await watchIndex(deps, state, { ...input, owner, held })
}

function rollDay(state: WatchState, day: TradingDay): void {
  if (state.day === day) {
    return
  }

  state.day = day
  state.newsSent.clear()
  state.indexCheckedAt = 0
  state.indexDropSent = false
}

async function sendHeldNews(
  deps: HeldWatchDeps,
  state: WatchState,
  input: PassInput & { readonly headlines: readonly InstrumentHeadline[] }
): Promise<void> {
  for (const headline of newestPerInstrument(input.headlines)) {
    const key = buildInstrumentKey(headline.instrument)

    if (state.newsSent.has(key)) {
      continue
    }

    const accepted = await sendNotice(deps, input, {
      kind: 'held-news',
      instrument: headline.instrument,
      title: headline.title,
      source: registrableDomain(headline.url) ?? headline.sourceId,
    })

    if (accepted) {
      state.newsSent.add(key)
    }
  }
}

/** The archive lists newest first, so the first story seen for a name is its newest. */
function newestPerInstrument(
  headlines: readonly InstrumentHeadline[]
): readonly InstrumentHeadline[] {
  const newest = new Map<string, InstrumentHeadline>()

  for (const headline of headlines) {
    const key = buildInstrumentKey(headline.instrument)

    if (!newest.has(key)) {
      newest.set(key, headline)
    }
  }

  return [...newest.values()]
}

interface IndexInput extends PassInput {
  readonly owner: Market
  readonly held: readonly InstrumentRef[]
}

async function watchIndex(
  deps: HeldWatchDeps,
  state: WatchState,
  input: IndexInput
): Promise<void> {
  const { owner, now } = input

  if (
    state.indexDropSent ||
    !isSessionRunning(owner, now) ||
    now - state.indexCheckedAt < INDEX_CHECK_INTERVAL_MS
  ) {
    return
  }

  state.indexCheckedAt = now

  const drop = await readIndexDrop(deps, input)

  if (drop === undefined) {
    return
  }

  const book = await readBookAgainstDrop(deps, input)

  if (book === undefined) {
    return
  }

  if (await sendNotice(deps, input, { kind: 'index-drop', ...drop, ...book })) {
    state.indexDropSent = true
  }
}

function isSessionRunning(owner: Market, now: number): boolean {
  const phase = sessionPhase(owner.manifest.calendar, now)

  return phase === 'open' || phase === 'break'
}

interface IndexDrop {
  readonly index: InstrumentRef
  /** A percent: -1.7 is down 1.7%. */
  readonly movePct: number
}

/** The market's own benchmark, read the way every surface reads an index row's session move. Absent
 *  where the market names no benchmark, the row is not in the overview, or the move is not a drop. */
async function readIndexDrop(
  deps: HeldWatchDeps,
  input: IndexInput
): Promise<IndexDrop | undefined> {
  const { owner, now, signal } = input
  const index = owner.manifest.benchmark

  if (index === undefined) {
    return undefined
  }

  const [overview] = await deps.reads.overview({ now, signal, markets: [owner.manifest.id] })
  const row = overview?.rows.find((candidate) => candidate.instrument.ticker === index.ticker)
  const movePct = row === undefined ? undefined : rowMoveIn(row, owner.manifest.calendar.dayAt(now))

  return movePct !== undefined && movePct <= -INDEX_DROP_PCT ? { index, movePct } : undefined
}

interface BookAgainstDrop {
  readonly heldDown: number
  readonly stopsBroken: number
}

/** How many holdings are down in the session, and how many sit at or through their plan's stop.
 *  Absent when a stop could not be read: saying none has broken without having looked would be the
 *  wrong way for this to be wrong, so the notice waits for the next read. */
async function readBookAgainstDrop(
  deps: HeldWatchDeps,
  input: IndexInput
): Promise<BookAgainstDrop | undefined> {
  const { now, signal } = input
  const distances = await deps.reads.stopDistances({ now, signal })

  if (
    distances.some(
      (distance) => distance.plan === 'distance' && stopStandingOf(distance) === 'unmeasured'
    )
  ) {
    return undefined
  }

  return {
    heldDown: await countHoldingsDown(deps.reads, input.held, signal),
    // A fund's lower level is a place to review, not a stop that broke.
    stopsBroken: distances.filter(
      (distance) => !distance.review && stopStandingOf(distance) === 'breached'
    ).length,
  }
}

/** The quote board reads a bounded number of names at a time, so the book goes in as many reads. */
async function countHoldingsDown(
  reads: HeldWatchReads,
  held: readonly InstrumentRef[],
  signal: AbortSignal
): Promise<number> {
  const size = SURFACE_LIMITS.maximumQuoteBoardItems
  let down = 0

  for (let from = 0; from < held.length; from += size) {
    const board = await reads.quoteBoard({ instruments: held.slice(from, from + size), signal })

    down += board.items.filter((item) => (quoteBoardMoveOf(item) ?? 0) < 0).length
  }

  return down
}

/** Whether the notice was accepted. A refusal is logged and the name is told about again on a later
 *  pass, since nothing was said. */
async function sendNotice(
  deps: HeldWatchDeps,
  input: PassInput,
  payload: TradingNotice['payload']
): Promise<boolean> {
  const outcome = await sendCaught(
    deps.sender,
    { target: input.target, locale: deps.locale, payload },
    input.signal
  )

  if (outcome !== 'accepted') {
    deps.logger.warn('trading.held_watch_undelivered', { kind: payload.kind, outcome })
  }

  return outcome === 'accepted'
}
