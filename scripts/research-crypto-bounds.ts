#!/usr/bin/env bun
// Measure the raw envelope of crypto's linearly-normalized factors, so their clip bounds come from
// the population the board scores rather than from another market's numbers. Two failures show up
// in what this prints: a factor pinned at its ceiling for most of a board cannot rank it, and a
// symmetric bound over an envelope that skews positive calls an ordinary advance exceptional.
//
// Usage:
//   bun scripts/research-crypto-bounds.ts
//   bun scripts/research-crypto-bounds.ts --config=/path/config.toml
//
// Sampled over every name the screen answered for, candidates and rejections alike. Every endpoint
// of each fetched series contributes a reading, which buys a few thousand observations from one
// fetch per name — and the screen above has just warmed the same windows, so the settled-day cache
// serves nearly all of them. The windows overlap, so these are envelope percentiles rather than
// independent draws, which is what a clip bound is read off.
//
// Reads crypto's own policy for the windows and current bounds so it measures what production
// computes. `scripts/` sits outside the market-isolation gate; runtime code may not do this.
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import { boot } from '@/app/api'
import { MS_PER_DAY, MS_PER_SECOND } from '@/core/utils/time'
import {
  CRYPTO_EVIDENCE_SESSIONS,
  CRYPTO_FACTOR_POLICY,
  CRYPTO_MARKET_REF,
  CRYPTO_TREND_SESSIONS,
} from '@/trading/markets/crypto/policy'
import { trendDistance } from '@/trading/markets/timeseries'
import { dayFromEpochSeconds, utcDayStartEpochMs } from '@/trading/sources/rows/normalization'

const MEASURED_IDS = ['trend'] as const
type MeasuredId = (typeof MEASURED_IDS)[number]

/** Above any board this market can return, so the screen reports every name it examined. */
const SCREEN_LIMIT = 2_000
const REPORTED_PERCENTILES = [5, 25, 50, 75, 95] as const
const PERCENT_SCALE = 100
const REPORTED_DECIMALS = 3
const EXIT_NO_DATA = 1

interface Scope {
  readonly marketData: MarketDataService
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

type Readings = Readonly<Record<MeasuredId, readonly number[]>>

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
    const { marketData } = app.resolve('tradingServices')

    report(await measure(marketData, Date.now(), app.signal))
  } finally {
    await booted.dispose()
  }
}

function flag(args: readonly string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
}

async function measure(
  marketData: MarketDataService,
  now: number,
  signal: AbortSignal
): Promise<Readings> {
  const board = await marketData.screen({
    market: CRYPTO_MARKET_REF,
    limit: SCREEN_LIMIT,
    now,
    signal,
  })
  // Survivors and gate rejections alike: a name the gates dropped was still scored against these
  // windows, and excluding it would measure the envelope of names that already passed.
  const examined = [
    ...board.candidates.map((candidate) => candidate.instrument.ticker),
    ...board.rejections.map((rejection) => rejection.instrument.ticker),
  ]

  const collected: Record<MeasuredId, number[]> = { trend: [] }

  // `exitCode` rather than `exit`, so the boot this measurement opened is still disposed.
  if (examined.length === 0) {
    process.stderr.write('no crypto names examined - is the market reachable?\n')
    process.exitCode = EXIT_NO_DATA

    return collected
  }

  const scope: Scope = { marketData, ...windowOf(board.asOf), now, signal }

  for (const ticker of examined) {
    collect(collected, await barsOf(scope, ticker))
    process.stderr.write(`${ticker}: ${collected.trend.length} readings\n`)
  }

  return collected
}

/** The evidence window the market itself asks for, so a reading here spans what a factor spans. */
function windowOf(asOf: TradingDay): { readonly fromDay: TradingDay; readonly toDay: TradingDay } {
  const startMs = utcDayStartEpochMs(asOf) - CRYPTO_EVIDENCE_SESSIONS * MS_PER_DAY

  return { fromDay: dayFromEpochSeconds(startMs / MS_PER_SECOND, 'UTC'), toDay: asOf }
}

async function barsOf(scope: Scope, ticker: Ticker): Promise<readonly Candle[]> {
  const result = await scope.marketData.bars({
    market: CRYPTO_MARKET_REF,
    ticker,
    fromDay: scope.fromDay,
    toDay: scope.toDay,
    now: scope.now,
    signal: scope.signal,
  })

  return result.kind === 'unavailable' ? [] : result.value
}

/** The helper reads the end of the series, so a prefix per endpoint is what rolls the window. */
function collect(into: Record<MeasuredId, number[]>, bars: readonly Candle[]): void {
  const closes = bars.map((candle) => candle.close)

  for (let end = 1; end <= closes.length; end += 1) {
    const prefix = closes.slice(0, end)

    push(into.trend, trendDistance(prefix, CRYPTO_TREND_SESSIONS))
  }
}

function push(into: number[], value: number | undefined): void {
  if (value !== undefined) {
    into.push(value)
  }
}

function report(readings: Readings): void {
  for (const id of MEASURED_IDS) {
    reportOne(id, readings[id])
  }
}

function reportOne(id: MeasuredId, values: readonly number[]): void {
  const sorted = [...values].sort((left, right) => left - right)

  if (sorted.length === 0) {
    process.stdout.write(`${id}: no readings\n`)

    return
  }

  const cells = REPORTED_PERCENTILES.map((pct) => `p${pct}=${fixed(percentile(sorted, pct))}`)

  process.stdout.write(`${id}: n=${sorted.length} ${cells.join(' ')}\n`)
  reportClipping(id, sorted)
}

/** What the current bound costs: a factor whose readings sit past it prints its ceiling and stops
 *  separating the names it was meant to rank. */
function reportClipping(id: MeasuredId, sorted: readonly number[]): void {
  const bounds = CRYPTO_FACTOR_POLICY.normalization[id]

  if (bounds.kind !== 'linear') {
    return
  }

  const clipped = sorted.filter(
    (value) => value <= bounds.bearishAt || value >= bounds.bullishAt
  ).length

  process.stdout.write(
    `  clipped at ${fixed(bounds.bearishAt)}/${fixed(bounds.bullishAt)}: ` +
      `${((clipped / sorted.length) * PERCENT_SCALE).toFixed(1)}%\n`
  )
}

function percentile(sorted: readonly number[], pct: number): number {
  const index = ((sorted.length - 1) * pct) / PERCENT_SCALE
  const lower = Math.floor(index)
  const low = sorted[lower] ?? 0
  const high = sorted[Math.ceil(index)] ?? low

  return low + (high - low) * (index - lower)
}

function fixed(value: number): string {
  return value.toFixed(REPORTED_DECIMALS)
}

await main()
