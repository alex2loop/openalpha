import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { LedgerDayRange } from '@/trading/features/ledger/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { CurrencyCode, Region, TradingDay } from '@/trading/kernel/instrument'
import type { LedgerEntryId } from '@/trading/kernel/operator/book'
import type { MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { renderLedgerText } from '@/trading/features/ledger/rows'
import { ledgerEntryHandle } from '@/trading/features/ledger/types'
import { quoteConventionsFor } from '@/trading/features/market-data/command/quote-conventions'
import { resolveRegionDay } from '@/trading/features/market-data/resolve'
import { tradingDay } from '@/trading/kernel/instrument'
import { parseBranded, usage } from '@/trading/kernel/surface/surface'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { pageAffordances } from '@/trading/render/affordance'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const USAGE: 'slash.tradingTransactionsUsage' = 'slash.tradingTransactionsUsage'
/** A page size is at most three digits, and a handle is six characters off a UUID tail - so a token
 *  is read as a count only where it could be one. */
const COUNT_RE = /^\d{1,3}$/
/** A full id or a slice of its tail. The last UUID group holds no hyphen, so a slice with one is at
 *  least thirteen characters, and a mistyped day (`2026-02-30`) is never looked up as a handle.
 *  Checked before the lookup because the store matches with `LIKE`, where `%` or `_` would be a
 *  wildcard. */
const ENTRY_REF_RE = /^(?:[0-9a-f]{1,12}|[0-9a-f-]{13,36})$/
const DAY_RANGE_SEPARATOR = '..'
const LAST_DAYS_RE = /^(\d{1,3})d$/
const TODAY_WINDOW = 'today'
const WEEK_WINDOW = 'week'
const MONTH_WINDOW = 'month'
const DAYS_PER_WEEK = 7

interface TransactionsCommandDeps {
  readonly portfolio: Pick<PortfolioService, 'historyAbsolute'>
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
  readonly ledger: Pick<LedgerStore, 'listIdsMatching'>
  readonly markets: MarketRegistry
  readonly defaultRegion: Region
  readonly baseCurrency: CurrencyCode
}

/** How much of the ledger this read asks for, over which days, and where it starts. Every slot is
 *  an order-free bare token: a count is a small number, a range is a window word or holds a day,
 *  and a handle is neither. */
interface TransactionsArgs {
  readonly limit: number
  readonly range?: LedgerDayRange
  readonly cursor?: string
}

export function createTransactionsCommand(deps: TransactionsCommandDeps): SlashCommand {
  return {
    name: 'transactions',
    description: { kind: 'localized', key: 'slash.tradingTransactionsHelp' },
    messageKeys: [USAGE],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'read',
    },
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: TransactionsCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const today = resolveRegionDay(deps.markets, deps.defaultRegion, Date.now())
  const parsed = parseTransactionsArgs(ctx.args, today)

  if (parsed === null) {
    return usage(USAGE)
  }

  const cursor = await resolveCursor(deps, parsed.cursor, ctx.signal)
  const page = await deps.portfolio.historyAbsolute({
    limit: parsed.limit,
    ...(parsed.range === undefined ? {} : { range: parsed.range }),
    ...(cursor === undefined ? {} : { cursor }),
    signal: ctx.signal,
  })

  const quoteConventions = quoteConventionsFor(
    deps.marketData,
    page.items.flatMap((entry) =>
      'instrument' in entry.transaction ? [entry.transaction.instrument] : []
    )
  )
  const rangeToken = parsed.range === undefined ? undefined : buildDayRangeToken(parsed.range)

  return {
    kind: 'text',
    affordances: pageAffordances(ctx.locale, cursorHandleOf(page.nextCursor), rangeToken),
    text: renderLedgerText(ctx.locale, page, {
      baseCurrency: deps.baseCurrency,
      quoteConventions,
      ...(parsed.range === undefined ? {} : { range: parsed.range }),
    }),
  }
}

/** `null` for a token that names no slot, or one that names a slot already filled - either is the
 *  usage line rather than a silent guess at what was meant. A range is tried before a handle
 *  because `7d` is also hex. */
function parseTransactionsArgs(
  args: readonly string[],
  today: TradingDay
): TransactionsArgs | null {
  let limit: number | undefined
  let range: LedgerDayRange | undefined
  let cursor: string | undefined

  for (const arg of args) {
    const token = arg.toLowerCase()
    const count = limit === undefined ? parseCount(token) : undefined

    if (count !== undefined) {
      limit = count
      continue
    }

    const parsedRange = range === undefined ? parseDayRange(token, today) : undefined

    if (parsedRange !== undefined) {
      range = parsedRange
      continue
    }

    if (cursor !== undefined || !ENTRY_REF_RE.test(token)) {
      return null
    }

    cursor = token
  }

  return {
    limit: limit ?? SURFACE_LIMITS.maximumHistoryItems,
    ...(range === undefined ? {} : { range }),
    ...(cursor === undefined ? {} : { cursor }),
  }
}

function parseCount(token: string): number | undefined {
  const count = COUNT_RE.test(token) ? Number(token) : undefined

  return count !== undefined && count > 0 && count <= SURFACE_LIMITS.maximumHistoryItems
    ? count
    : undefined
}

/** A window word ends today on the calendar that dates every ledger row, so a trade booked this
 *  morning in UTC+7 is inside `today` before the UTC day rolls over. */
function parseDayRange(token: string, today: TradingDay): LedgerDayRange | undefined {
  const fromDay = resolveWindowStart(token, today)

  return fromDay === undefined ? parseDaySpan(token) : { fromDay, toDay: today }
}

function resolveWindowStart(token: string, today: TradingDay): TradingDay | undefined {
  if (token === TODAY_WINDOW) {
    return today
  }

  if (token === WEEK_WINDOW) {
    return weekStartOf(today)
  }

  if (token === MONTH_WINDOW) {
    return monthStartOf(today)
  }

  const days = LAST_DAYS_RE.exec(token)?.[1]

  if (days === undefined || Number(days) === 0) {
    return undefined
  }

  return shiftCalendarDay(today, 1 - Number(days))
}

/** Monday opens the week, the ISO convention both locales read. */
function weekStartOf(day: TradingDay): TradingDay {
  const sinceMonday = (new Date(day).getUTCDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK

  return shiftCalendarDay(day, -sinceMonday)
}

function monthStartOf(day: TradingDay): TradingDay {
  return shiftCalendarDay(day, 1 - new Date(day).getUTCDate())
}

/** One day, or `from..to` with either end left open. A start after its end names no day at all,
 *  so it is refused rather than read as empty. */
function parseDaySpan(token: string): LedgerDayRange | undefined {
  const [fromText = '', toText, ...extra] = token.split(DAY_RANGE_SEPARATOR)

  if (toText === undefined) {
    const day = parseBranded(fromText, tradingDay)

    return day === null ? undefined : { fromDay: day, toDay: day }
  }

  if (extra.length > 0 || (fromText === '' && toText === '')) {
    return undefined
  }

  const fromDay = fromText === '' ? undefined : parseBranded(fromText, tradingDay)
  const toDay = toText === '' ? undefined : parseBranded(toText, tradingDay)

  if (fromDay === null || toDay === null) {
    return undefined
  }

  if (fromDay !== undefined && toDay !== undefined && fromDay > toDay) {
    return undefined
  }

  return {
    ...(fromDay === undefined ? {} : { fromDay }),
    ...(toDay === undefined ? {} : { toDay }),
  }
}

/** The days a window word resolved to, never the word: a `7d` page opened tomorrow still reads on
 *  through the week it was asked about. */
function buildDayRangeToken(range: LedgerDayRange): string {
  if (range.fromDay !== undefined && range.fromDay === range.toDay) {
    return range.fromDay
  }

  return `${range.fromDay ?? ''}${DAY_RANGE_SEPARATOR}${range.toDay ?? ''}`
}

/** The button carries the handle the rows print, not the full id: a payload has 64 bytes on the
 *  wire, and a UUID plus the command would spend most of them. */
function cursorHandleOf(cursor: LedgerEntryId | undefined): string | undefined {
  return cursor === undefined ? undefined : ledgerEntryHandle(cursor)
}

/** A handle nothing answers to is refused the way `/update` refuses one: a page starting from the
 *  newest row would read as the answer to a question nobody asked. */
async function resolveCursor(
  deps: TransactionsCommandDeps,
  ref: string | undefined,
  signal: AbortSignal
): Promise<LedgerEntryId | undefined> {
  if (ref === undefined) {
    return undefined
  }

  const [found] = await deps.ledger.listIdsMatching(ref, signal)

  if (found === undefined) {
    throw new ValidationError(`no ledger entry ${ref}`, {
      key: 'errors.ledgerEntryUnknown',
      params: { ref },
    })
  }

  return found
}
