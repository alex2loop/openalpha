#!/usr/bin/env bun
// Measure the composite score's spread across recent sessions, so the conviction cut points come
// from the distribution the board actually produces rather than from one morning's board.
//
// Usage:
//   bun scripts/research-conviction-bands.ts                       # equity-vn, up to the last 40 sessions
//   bun scripts/research-conviction-bands.ts --market=crypto
//   bun scripts/research-conviction-bands.ts --sessions=60
//   bun scripts/research-conviction-bands.ts --config=/path/config.toml
//
// The sessions are one board seen repeatedly, so the session count multiplies rows, not evidence.
import type { ConvictionBand } from '@/trading/kernel/conviction'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'
import { boot } from '@/app/api'
import { MS_PER_DAY, parseIsoDay } from '@/core/utils/time'
import {
  CONTESTED_TARGET_FRACTION,
  HIGH_BAND_TARGET_FRACTION,
  MEDIUM_BAND_TARGET_FRACTION,
} from '@/trading/markets/conviction-calibration'
import { CONVICTION_BANDS } from '@/trading/kernel/conviction'
import { marketRef } from '@/trading/kernel/instrument'
import { screenRating } from '@/trading/markets/screen-rating'

const DEFAULT_MARKET = 'equity-vn'
const DEFAULT_SESSIONS = 40
const SCREEN_LIMIT = 2_000
const REPORTED_PERCENTILES = [50, 75, 90, 95, 99] as const
const PERCENT_SCALE = 100
const EXIT_NO_DATA = 1
const EXIT_BAD_ARGUMENT = 2

interface Session {
  readonly day: string
  /** Names under the coverage floor, left out: their composite is a model that did not run. */
  readonly dropped: number
  readonly strengths: readonly number[]
  readonly bands: readonly ConvictionBand[]
  /** Agreement of the low-band names, the only ones the bar can rate contested. */
  readonly contestable: readonly number[]
  readonly contested: number
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const configPath = flag(args, 'config')
  const market = marketRef(flag(args, 'market') ?? DEFAULT_MARKET)
  const sessions = Number(flag(args, 'sessions') ?? DEFAULT_SESSIONS)

  if (!Number.isInteger(sessions) || sessions <= 0) {
    console.error('--sessions must be a positive whole number')
    process.exitCode = EXIT_BAD_ARGUMENT

    return
  }

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
    const sampled = await sample(marketData, { market, sessions }, app.signal)

    report(market, sampled)
  } finally {
    await booted.dispose()
  }
}

function flag(args: readonly string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
}

/** One screen per session walked backwards. Each step asks at 00:00 UTC of the day the last board
 *  reported, which every calendar here resolves to the session before it, so non-session days are
 *  never screened and no session is skipped. */
async function sample(
  marketData: MarketDataService,
  scope: { readonly market: MarketRef; readonly sessions: number },
  signal: AbortSignal
): Promise<readonly Session[]> {
  const { market, sessions } = scope
  const collected: Session[] = []
  const seen = new Set<string>()
  let now = Date.now()

  for (let attempt = 0; collected.length < sessions && attempt < sessions * 2; attempt += 1) {
    const result = await marketData.screen({ market, limit: SCREEN_LIMIT, now, signal })
    const day = result.dataThroughDay ?? result.asOf

    // At least a day back, so a board whose day never moves cannot pin the walk.
    now = Math.min(now - MS_PER_DAY, parseIsoDay(day) ?? now)

    if (result.candidates.length === 0 || seen.has(day)) {
      continue
    }

    seen.add(day)

    const rated = result.candidates.filter(
      (candidate) => candidate.composite.coverageBelowMinimum === false
    )

    // Coverage only shrinks going back, so the first empty board after a rated one ends the window.
    if (rated.length === 0) {
      process.stderr.write(`${day}: every name below coverage\n`)

      if (collected.length > 0) {
        break
      }

      continue
    }

    collected.push({
      day,
      dropped: result.candidates.length - rated.length,
      strengths: strengthsOf(rated),
      bands: rated.map((candidate) => candidate.composite.band),
      contestable: contestableOf(rated),
      contested: rated.filter((candidate) => screenRating(candidate) === 'contested').length,
    })
    process.stderr.write(
      `${day}: ${rated.length} rated, ${result.candidates.length - rated.length} below coverage\n`
    )
  }

  return collected
}

function strengthsOf(candidates: readonly ScreenCandidate[]): readonly number[] {
  return candidates
    .map((candidate) => Math.abs(candidate.composite.score))
    .sort((left, right) => left - right)
}

function contestableOf(candidates: readonly ScreenCandidate[]): readonly number[] {
  return candidates.flatMap((candidate) =>
    candidate.composite.band === 'low' ? (candidate.composite.agreement ?? []) : []
  )
}

function report(market: MarketRef, sessions: readonly Session[]): void {
  const strengths = [...sessions.flatMap((session) => session.strengths)].sort(
    (left, right) => left - right
  )

  // `exitCode` rather than `exit`, so the boot this sampling opened is still disposed.
  if (strengths.length === 0) {
    console.error('no screened candidates in the sampled window')
    process.exitCode = EXIT_NO_DATA

    return
  }

  console.log(`\n${market}: ${sessions.length} sessions, ${strengths.length} scored names`)
  console.log(`|composite| percentiles`)

  for (const pct of REPORTED_PERCENTILES) {
    console.log(`  p${pct}  ${percentile(strengths, pct).toFixed(4)}`)
  }

  reportBands(strengths, sessions.flatMap((session) => session.bands))
  reportAgreement(sessions, strengths.length)
  reportSessions(sessions)
}

/** A pooled percentile hides a regime break; the per-session share shows one. */
function reportSessions(sessions: readonly Session[]): void {
  console.log(`\nper session: names rated, share at full conviction, names below coverage`)

  for (const { day, bands, dropped } of sessions) {
    const high = bands.filter((band) => band === 'high').length
    const share = bands.length === 0 ? '  n/a' : ((high / bands.length) * PERCENT_SCALE).toFixed(1)

    console.log(
      `  ${day}  ${String(bands.length).padStart(4)} rated  ${share.padStart(5)}%  ` +
        `${String(dropped).padStart(4)} below coverage`
    )
  }
}

/** Read off the bands the market itself stamped, so it reports what the live policy produced. */
function reportBands(strengths: readonly number[], bands: readonly ConvictionBand[]): void {
  console.log(`\nwhat this market's current cut points produce`)

  for (const band of CONVICTION_BANDS) {
    const share = bands.filter((entry) => entry === band).length / bands.length

    console.log(`  ${band.padEnd(7)} ${(share * PERCENT_SCALE).toFixed(1)}%`)
  }

  const suggestedHigh = percentile(strengths, PERCENT_SCALE * (1 - HIGH_BAND_TARGET_FRACTION))
  const suggestedMedium = percentile(strengths, PERCENT_SCALE * (1 - MEDIUM_BAND_TARGET_FRACTION))
  const top = HIGH_BAND_TARGET_FRACTION * PERCENT_SCALE
  const atLeastMedium = MEDIUM_BAND_TARGET_FRACTION * PERCENT_SCALE

  console.log(`\nfor ${top}% of the board at high and ${atLeastMedium}% at medium or better`)
  console.log(`  highConvictionAt   ${suggestedHigh.toFixed(4)}`)
  console.log(`  mediumConvictionAt ${suggestedMedium.toFixed(4)}`)
  console.log(`\nbands read |score|, so these are strength cut points and carry no direction.`)
}

function reportAgreement(sessions: readonly Session[], names: number): void {
  const agreements = [...sessions.flatMap((session) => session.contestable)].sort(
    (left, right) => left - right
  )
  const contested = sessions.reduce((sum, session) => sum + session.contested, 0)
  const share = ((contested / names) * PERCENT_SCALE).toFixed(1)

  console.log(`\nagreement, over the ${agreements.length} names a bar can bite`)
  console.log(`  contested now  ${share}% of the board`)

  if (agreements.length === 0) {
    return
  }

  for (const pct of REPORTED_PERCENTILES) {
    console.log(`  p${pct}  ${percentile(agreements, pct).toFixed(4)}`)
  }

  const wanted = Math.min(
    PERCENT_SCALE,
    (CONTESTED_TARGET_FRACTION * names * PERCENT_SCALE) / agreements.length
  )

  console.log(`\nfor a ${CONTESTED_TARGET_FRACTION * PERCENT_SCALE}% contested board`)
  console.log(`  minimumAgreement   ${percentile(agreements, wanted).toFixed(4)}`)
}

/** Nearest-rank on a pre-sorted ascending series. */
function percentile(sorted: readonly number[], pct: number): number {
  const index = Math.min(sorted.length - 1, Math.floor((pct / PERCENT_SCALE) * sorted.length))

  return sorted[index] ?? 0
}

await main()
