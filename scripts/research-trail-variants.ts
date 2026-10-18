#!/usr/bin/env bun
// Holds the trail this tree computes against the Chandelier Exit the policy comment names. Both
// columns share production's entry, initial stop, target and exit test, so the only thing that
// differs is where the trail hangs: `stored` takes the highest close of the trail window less three
// ATR over `atrSessions`, `canonical` takes the highest high less three ATR over the trail window
// itself, which is LeBeau's rule and what every published implementation computes, and
// `since-entry` is `stored` with the window starting no earlier than the entry, the anchoring most
// practitioners use once in a position.
//
// Usage:
//   bun scripts/research-trail-variants.ts --config=./config.toml
//
// Reads stored bars only, so a run calls no provider, costs nothing and repeats exactly. Trades are
// scored in R, which is what lets names of different price and volatility be summed, and the
// per-name count is printed beside the total because a total carried by three coins is not an edge.
//
// `scripts/` sits outside the market-isolation gate; runtime code may not read a market's policy
// this way.
import type { Dialect, Storage } from '@/core/types/storage'
import type { LevelPolicy } from '@/trading/kernel/factor'
import type { Candle } from '@/trading/kernel/market/market-data'
import { boot } from '@/app/api'
import { tradingDay } from '@/trading/kernel/instrument'
import {
  CRYPTO_BREAKOUT_SESSIONS,
  CRYPTO_LEVEL_POLICY,
  CRYPTO_MARKET_REF,
} from '@/trading/markets/crypto/policy'
import { averageTrueRange } from '@/trading/markets/levels'
import { trailingHigh } from '@/trading/markets/timeseries'

/** The horizon the crypto segment is planned on, which selects the stop and target multiple. */
const HORIZON = 'short'
/** Sessions a name must carry before it trades here: the longest window this prices, plus room for
 *  the windows to be measured against something. */
const WARMUP_SESSIONS = 120
const REPORTED_DECIMALS = 2
const PERCENT_SCALE = 100
const EXIT_NO_DATA = 1

type TrailPolicy = NonNullable<LevelPolicy['trail']>
type ExitReason = 'target' | 'trail' | 'entry-stop'

interface Variant {
  readonly id: string
  /** Which price the ceiling hangs from, and whether sessions before the entry count. */
  readonly ceiling: 'close' | 'high' | 'close-since-entry'
  readonly atrSessions: number
  readonly windowSessions: number
  readonly multiplier: number
}

interface Trade {
  readonly reason: ExitReason
  readonly r: number
}

/** One name under one variant. */
interface NameResult {
  readonly trades: readonly Trade[]
  readonly open: boolean
}

interface Tally {
  readonly trades: readonly Trade[]
  readonly open: number
  /** Total R per name, so a result carried by a handful of coins shows as one. */
  readonly byName: ReadonlyMap<string, number>
}

async function main(): Promise<void> {
  const configPath = flag(process.argv.slice(2), 'config')
  const booted = await boot({
    mode: 'cli',
    startup: 'migrate',
    env: process.env,
    configFile: 'required',
    shutdownSignal: new AbortController().signal,
    ...(configPath === undefined ? {} : { configPath }),
  })

  try {
    const { app } = booted

    report(await measure(app.resolve('storage'), app.resolve('dialect')))
  } finally {
    await booted.dispose()
  }
}

function flag(args: readonly string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
}

async function measure(storage: Storage, dialect: Dialect): Promise<ReadonlyMap<string, Tally>> {
  const trail = CRYPTO_LEVEL_POLICY.trail
  const tallies = new Map<string, Tally>()

  if (trail === undefined) {
    process.stderr.write('crypto declares no trail - nothing to compare\n')
    process.exitCode = EXIT_NO_DATA

    return tallies
  }

  const series = await storedSeries(storage, dialect)

  for (const variant of variantsOf(trail)) {
    tallies.set(variant.id, tallyOf(series, variant))
  }

  process.stderr.write(`${series.size} names, ${sessionCount(series)} stored sessions\n`)

  return tallies
}

/** Three readings of one rule: the stored one takes its ATR from the entry stop's window, the
 *  canonical one ties ATR to the lookback the way the published formula does, and the since-entry
 *  one is the stored rule blind to the sessions before the entry. */
function variantsOf(trail: TrailPolicy): readonly Variant[] {
  const shared = { windowSessions: trail.sessions, multiplier: trail.volatilityMultiplier }

  return [
    { id: 'stored', ceiling: 'close', atrSessions: CRYPTO_LEVEL_POLICY.atrSessions, ...shared },
    { id: 'canonical', ceiling: 'high', atrSessions: trail.sessions, ...shared },
    {
      id: 'since-entry',
      ceiling: 'close-since-entry',
      atrSessions: CRYPTO_LEVEL_POLICY.atrSessions,
      ...shared,
    },
  ]
}

function tallyOf(series: ReadonlyMap<string, readonly Candle[]>, variant: Variant): Tally {
  const trades: Trade[] = []
  const byName = new Map<string, number>()
  let open = 0

  for (const [ticker, candles] of series) {
    const result = simulate(candles, variant)

    trades.push(...result.trades)
    byName.set(ticker, sum(result.trades.map((trade) => trade.r)))
    open += result.open ? 1 : 0
  }

  return { trades, open, byName }
}

/** Every crypto name the book holds bars for, oldest session first. */
async function storedSeries(
  storage: Storage,
  dialect: Dialect
): Promise<ReadonlyMap<string, readonly Candle[]>> {
  const rows = await storage.query<{
    readonly ticker: string
    readonly day: string
    readonly open: number
    readonly high: number
    readonly low: number
    readonly close: number
  }>(
    `SELECT ticker, day, open, high, low, close FROM daily_bars WHERE market = ${dialect.param(1)} ` +
      'ORDER BY ticker ASC, day ASC',
    [CRYPTO_MARKET_REF]
  )
  const series = new Map<string, Candle[]>()

  for (const row of rows) {
    const candles = series.get(row.ticker) ?? []

    // Volume is read by no level this prices, so the series carries only what it does read.
    candles.push({ ...row, at: tradingDay(row.day), volume: 0, adjustment: 'raw' })
    series.set(row.ticker, candles)
  }

  return new Map([...series].filter(([, candles]) => candles.length > WARMUP_SESSIONS))
}

function sessionCount(series: ReadonlyMap<string, readonly Candle[]>): number {
  return [...series.values()].reduce((total, candles) => total + candles.length, 0)
}

/** One pass per name: enter on the breakout the market enters on, hold under the ratcheted trail,
 *  and leave where `isSpent` would call the plan spent — on the settled close, both sides. */
function simulate(candles: readonly Candle[], variant: Variant): NameResult {
  const trades: Trade[] = []
  let position: Position | undefined

  for (let index = WARMUP_SESSIONS; index < candles.length; index += 1) {
    const prior = candles.slice(0, index)
    const close = candles[index]?.close

    if (close === undefined) {
      continue
    }

    if (position === undefined) {
      position = entryAt(prior, { close, at: index })
      continue
    }

    const exited = step(position, { prior, close, variant })

    if (exited !== undefined) {
      trades.push(exited)
      position = undefined
    }
  }

  return { trades, open: position !== undefined }
}

interface Position {
  /** The entry session's index in the series, where a since-entry ceiling starts. */
  readonly openedAt: number
  readonly entry: number
  readonly risk: number
  readonly target: number
  readonly entryStop: number
  stop: number
}

/** The market's own entry: a close above the highest close of the breakout window before it. */
function entryAt(
  prior: readonly Candle[],
  session: { readonly close: number; readonly at: number }
): Position | undefined {
  const { close } = session
  const breakout = trailingHigh(
    prior.map((candle) => candle.close),
    CRYPTO_BREAKOUT_SESSIONS
  )
  const atr = averageTrueRange(prior, CRYPTO_LEVEL_POLICY.atrSessions)

  if (breakout === undefined || close <= breakout || !(atr > 0)) {
    return undefined
  }

  const risk = atr * CRYPTO_LEVEL_POLICY.stopVolatilityMultiplier[HORIZON]

  return {
    openedAt: session.at,
    entry: close,
    risk,
    entryStop: close - risk,
    stop: close - risk,
    target: close + risk * CRYPTO_LEVEL_POLICY.targetRiskMultiplier[HORIZON],
  }
}

interface StepInput {
  readonly prior: readonly Candle[]
  readonly close: number
  readonly variant: Variant
}

/** Raises the stop the way `trailPlanStop` does — upward only, never above the close — then tests
 *  both barriers against that same close. */
function step(position: Position, input: StepInput): Trade | undefined {
  const { prior, close, variant } = input
  const trailed = trailOf(prior, variant, position.openedAt)

  if (trailed !== undefined && trailed > position.stop && trailed < close) {
    position.stop = trailed
  }

  if (close >= position.target) {
    return { reason: 'target', r: (close - position.entry) / position.risk }
  }

  if (close <= position.stop) {
    return {
      reason: position.stop > position.entryStop ? 'trail' : 'entry-stop',
      r: (close - position.entry) / position.risk,
    }
  }

  return undefined
}

function trailOf(
  prior: readonly Candle[],
  variant: Variant,
  openedAt: number
): number | undefined {
  const ceiling =
    variant.ceiling === 'close-since-entry'
      ? sinceEntryHigh(prior, variant.windowSessions, openedAt)
      : trailingHigh(
          prior.map((candle) => (variant.ceiling === 'close' ? candle.close : candle.high)),
          variant.windowSessions
        )
  const atr = averageTrueRange(prior, variant.atrSessions)

  return ceiling === undefined || !(atr > 0) ? undefined : ceiling - atr * variant.multiplier
}

/** The highest close of the trail window, counting no session before the entry's own. */
function sinceEntryHigh(
  prior: readonly Candle[],
  windowSessions: number,
  openedAt: number
): number | undefined {
  const closes = prior
    .slice(Math.max(openedAt, prior.length - windowSessions))
    .map((candle) => candle.close)

  return closes.length === 0 ? undefined : Math.max(...closes)
}

function report(tallies: ReadonlyMap<string, Tally>): void {
  for (const [id, tally] of tallies) {
    const { trades } = tally
    const wins = trades.filter((trade) => trade.r > 0)
    const gross = sum(wins.map((trade) => trade.r))
    const lost = -sum(trades.filter((trade) => trade.r <= 0).map((trade) => trade.r))
    const decided = Math.max(trades.length, 1)

    process.stdout.write(
      `${id.padEnd(10)} trades=${trades.length} open=${tally.open} ` +
        `win=${fixed((wins.length / decided) * PERCENT_SCALE)}% ` +
        `profitFactor=${fixed(lost === 0 ? gross : gross / lost)} ` +
        `avgR=${fixed(sum(trades.map((trade) => trade.r)) / decided)} ` +
        `totalR=${fixed(sum(trades.map((trade) => trade.r)))} ` +
        `${exitMix(trades)}\n`
    )
  }

  process.stdout.write(headToHead(tallies))
}

/** How many names each variant carries against the stored one. A total one variant wins while
 *  losing most names is an artefact of a few coins, which is the reading these lines exist to
 *  expose. */
function headToHead(tallies: ReadonlyMap<string, Tally>): string {
  const [first, ...rest] = [...tallies]

  return first === undefined ? '' : rest.map((other) => pairLine(first, other)).join('')
}

function pairLine(first: readonly [string, Tally], second: readonly [string, Tally]): string {
  const [firstId, firstTally] = first
  const [secondId, secondTally] = second
  const names = [...firstTally.byName.keys()]
  const won = names.filter((name) => totalOf(firstTally, name) > totalOf(secondTally, name)).length
  const drawn = names.filter(
    (name) => totalOf(firstTally, name) === totalOf(secondTally, name)
  ).length

  return (
    `head-to-head ${firstId}=${won} ${secondId}=${names.length - won - drawn} ` +
    `equal=${drawn} of ${names.length} names\n`
  )
}

function totalOf(tally: Tally, name: string): number {
  return tally.byName.get(name) ?? 0
}

function exitMix(trades: readonly Trade[]): string {
  const reasons: readonly ExitReason[] = ['target', 'trail', 'entry-stop']

  return reasons
    .map((reason) => `${reason}=${trades.filter((trade) => trade.reason === reason).length}`)
    .join(' ')
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function fixed(value: number): string {
  return value.toFixed(REPORTED_DECIMALS)
}

await main()
