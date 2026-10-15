import type { TradingDay } from '@/trading/kernel/instrument'
import type { DailyTradeSides } from '@/trading/kernel/market/market-data'
import type { MarketDeps } from '@/trading/markets/deps'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { isAbortError } from '@/core/errors'
import { isTapeServing, resolveSettledDay } from '@/trading/markets/calendar'
import { DISTRIBUTION_BALANCE_AT, VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { aggressorBalance } from '@/trading/markets/equity-vn/tape/trade-sides'
import { STAGE_PASS } from '@/trading/markets/stage'

const DISTRIBUTION_STAGE_ID = 'equity-vn-distribution'
const DISTRIBUTION_STAGE_ORDER = 20

/** The session travels with the balance, so the caveat can say which day it describes. */
interface DistributionReading {
  readonly balance: number
  readonly at: TradingDay
}

/** How the name's last settled session actually traded, reported on a name the pipeline already
 *  wants to buy. It states who was in charge and leaves the timing to the operator: it never argues
 *  with the thesis and never changes the size. */
export function createVnDistributionStage(deps: MarketDeps): Stage {
  return {
    id: DISTRIBUTION_STAGE_ID,
    phase: 'tradeability',
    order: DISTRIBUTION_STAGE_ORDER,
    evaluate: (input) => evaluate(deps, input),
  }
}

async function evaluate(deps: MarketDeps, input: StageInput): Promise<StageDecision> {
  const { suggestion } = input

  if (suggestion.instrument.market !== VN_MARKET_REF || suggestion.action !== 'buy') {
    return STAGE_PASS
  }

  const reading = await sessionReading(deps, input)

  if (reading === undefined || reading.balance > DISTRIBUTION_BALANCE_AT) {
    return STAGE_PASS
  }

  return {
    kind: 'pass',
    caveats: [
      {
        code: 'market.distribution-session',
        detail: { imbalance: -reading.balance, day: reading.at },
      },
    ],
  }
}

/** The sweep's rows first, then the tape itself for a name the sweep never reached. The sweep
 *  covers what the operator holds or watches, while a buy candidate is typically neither — named
 *  outright or picked off a screen board — so reading only the store leaves this stage passing
 *  silently on exactly the candidates it exists to judge.
 *
 *  Both reads ask for the same session, the one a day-less tape would answer with right now. Asking
 *  the store for a window instead let a two-session-old row stand in for a session the tape was
 *  still serving, and the caveat then described a tape the operator had moved past — inverted, on
 *  the day it was measured.
 *
 *  One guard over both reads: a store that fails and a tape that fails answer the same question the
 *  same way, and a stage that throws becomes a block while trade sides are optional enrichment. */
async function sessionReading(
  deps: MarketDeps,
  input: StageInput
): Promise<DistributionReading | undefined> {
  const settled = resolveSettledDay(input.market.manifest.calendar, input.now)

  try {
    return (await storedReading(deps, input, settled)) ?? (await fetchedReading(input, settled))
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return undefined
  }
}

/** What the sweep recorded for that session, which is a row only for a name the operator holds or
 *  watches. Reading `suggestion.at` instead finds nothing: a run is dated by its own calendar day
 *  and trade sides exist for settled sessions only. */
async function storedReading(
  deps: MarketDeps,
  input: StageInput,
  settled: TradingDay
): Promise<DistributionReading | undefined> {
  const stored = await deps.marketDataStore.listTradeSides({
    instrument: input.suggestion.instrument,
    fromDay: settled,
    toDay: settled,
    signal: input.signal,
  })
  const [row] = stored

  return row === undefined ? undefined : toReading(row)
}

/** One settled session off the tape, and only while the tape is still serving it: the providers
 *  behind this capability take no date, so outside that window the reply describes a session other
 *  than the one asked for. Nothing is stored — the brief's own rows are whatever the sweep reached,
 *  and a name researched once would otherwise join a section listing what the operator follows. */
async function fetchedReading(
  input: StageInput,
  settled: TradingDay
): Promise<DistributionReading | undefined> {
  if (!isTapeServing(input.market.manifest.calendar, settled, input.now)) {
    return undefined
  }

  const result = await input.market.capabilities.tradeSides?.run({
    instrument: input.suggestion.instrument,
    asOf: settled,
    now: input.now,
    signal: input.signal,
  })

  return result?.kind === 'available' ? toReading(result.value) : undefined
}

function toReading(snapshot: DailyTradeSides): DistributionReading | undefined {
  const balance = aggressorBalance(snapshot)

  return balance === undefined ? undefined : { balance, at: snapshot.at }
}
