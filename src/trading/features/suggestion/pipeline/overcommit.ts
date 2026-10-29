import type { BatchOvercommit } from '@/trading/features/suggestion/batch-types'
import type {
  OpenRisk,
  SuggestionPortfolioContext,
} from '@/trading/features/suggestion/pipeline/types'
import type { SuggestionRunResult } from '@/trading/features/suggestion/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import { armsExit } from '@/trading/features/suggestion/types'

/** One buy against a budget is the sizer's own answer; only two of them together are a fact no
 *  single row can carry. */
const MINIMUM_BUYS = 2

interface OvercommitInput {
  readonly results: readonly SuggestionRunResult[]
  readonly markets: MarketRegistry
  /** What a buy's cash draw exceeds its notional by: the sizer's own headroom for fee and drift. */
  buyCashMultiple(market: MarketRef): number
  /** Asked for only once the set has two sized buys, and memoised by the batch's one clock read. */
  readContext(): Promise<SuggestionPortfolioContext>
  /** The room the book had before the batch, read as the sizer read it. */
  readOpenRisk(context: SuggestionPortfolioContext): Promise<OpenRisk | undefined>
}

/** A sized buy, with the cash it draws and what it stands to lose at its stop. */
interface SizedBuy {
  readonly market: MarketRef
  /** The notional times the cash multiple: what the sizer held against spendable cash. */
  readonly cashPctNav: number
  readonly units: number
  /** Market currency per unit, from the stored stop: a stop the run lifted to a held one sits above
   *  the entry-relative level the sizer budgeted, so the sum errs toward silence, never toward a
   *  warning the buys did not earn. Zero where nothing arms the stop. */
  readonly riskPerUnit: number
}

interface BookRead {
  readonly context: SuggestionPortfolioContext
  readonly markets: MarketRegistry
  readonly navBase: number
}

/** Every item sizes against the same pre-batch cash and open-risk room, so each buy fits alone and
 *  the set may not. Only buys count: the sizer credits no sale's proceeds to cash, and a sale
 *  lowers open risk only once it settles. */
export async function overcommittedBook(
  input: OvercommitInput
): Promise<readonly BatchOvercommit[]> {
  const buys = input.results.flatMap((result) => sizedBuyOf(result, input))

  if (buys.length < MINIMUM_BUYS) {
    return []
  }

  const context = await input.readContext()
  const navBase = context.book.navBase

  if (navBase === undefined || navBase <= 0) {
    return []
  }

  const read = { context, markets: input.markets, navBase }
  // Nothing armed adds no open risk, so the plans of the held names need not be read for it.
  const openRisk = buys.some((buy) => buy.riskPerUnit > 0)
    ? await input.readOpenRisk(context)
    : undefined

  return [
    ...cashOvercommit(buys, read),
    ...(openRisk === undefined ? [] : openRiskOvercommit(buys, read, openRisk)),
  ]
}

function sizedBuyOf(result: SuggestionRunResult, input: OvercommitInput): readonly SizedBuy[] {
  if (result.kind !== 'completed') {
    return []
  }

  const { suggestion } = result

  if (suggestion.action !== 'buy' || suggestion.sizePctNav === undefined) {
    return []
  }

  return [
    {
      market: suggestion.instrument.market,
      cashPctNav: suggestion.sizePctNav * input.buyCashMultiple(suggestion.instrument.market),
      units: suggestion.units ?? 0,
      riskPerUnit: armsExit(suggestion) ? Math.max(suggestion.entry - suggestion.stop, 0) : 0,
    },
  ]
}

/** Cash is the sizer's own rule: spendable is what the book holds less the reserve, a buy draws its
 *  notional times the cash multiple, and one market may reach less of it. A market is named only where its reach is the narrower ceiling, so the
 *  whole book's line is never repeated under it. */
function cashOvercommit(buys: readonly SizedBuy[], read: BookRead): readonly BatchOvercommit[] {
  const { context, navBase } = read
  const spendablePctNav = Math.max(
    context.book.book.availableCashBase / navBase - context.profile.reservePctNav,
    0
  )
  const needByMarket = new Map<MarketRef, number>()

  for (const buy of buys) {
    needByMarket.set(buy.market, (needByMarket.get(buy.market) ?? 0) + buy.cashPctNav)
  }

  const total = [...needByMarket.values()].reduce((sum, need) => sum + need, 0)
  const book: readonly BatchOvercommit[] =
    total > spendablePctNav
      ? [{ kind: 'cash', needPctNav: total, availablePctNav: spendablePctNav }]
      : []
  const markets = [...needByMarket].flatMap(([market, need]): readonly BatchOvercommit[] => {
    const reachable = context.reachableCashBase.get(market)
    const reachablePctNav = reachable === undefined ? undefined : reachable / navBase

    return reachablePctNav !== undefined &&
      reachablePctNav < spendablePctNav &&
      need > reachablePctNav
      ? [{ kind: 'cash', market, needPctNav: need, availablePctNav: reachablePctNav }]
      : []
  })

  return [...book, ...markets]
}

/** What the buys stand to lose at their stops, against the room the book left under the ceiling.
 *  A buy whose market's rate is unread adds nothing: the sizer would not have sized it. */
function openRiskOvercommit(
  buys: readonly SizedBuy[],
  read: BookRead,
  openRisk: OpenRisk
): readonly BatchOvercommit[] {
  const { context, markets, navBase } = read
  const availablePctNav = Math.max(context.profile.maximumOpenRiskPctNav - openRisk.pctNav, 0)
  let riskBase = 0

  for (const buy of buys) {
    const currency = markets.find(buy.market)?.manifest.currency
    const rate = currency === undefined ? undefined : context.rateToBase.get(currency)

    riskBase += rate === undefined ? 0 : buy.units * buy.riskPerUnit * rate
  }

  const needPctNav = riskBase / navBase

  return needPctNav > availablePctNav ? [{ kind: 'open-risk', needPctNav, availablePctNav }] : []
}
