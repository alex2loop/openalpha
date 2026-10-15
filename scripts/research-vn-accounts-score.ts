#!/usr/bin/env bun
// Does a weak Piotroski score on a VN annual report come before a weak year for the stock? Scores
// every covered name's reports on the day each became final, under the live scorer's own rule, and
// follows the adjusted close for a year from there. Also reports each sector's own weak-minus-rest
// spread, so a sector's swings are not read as the report's, and how often Beneish's M-score trips
// on this board.
//
// Usage:
//   bun scripts/research-vn-accounts-score.ts --db=$HOME/.openalpha/data/openalpha.sqlite --limit=40
//   add --cache=<dir> to keep every answer on disk: a rerun reads it back and sends no request.
//
// Read it as a shape, not a return:
//   - Survivorship: the names are today's active listings, so every delisted loser is missing.
//   - Restatement lookahead: the provider serves only a report's newest version.
//   - Returns are raw and equal-weighted; the "all" column is the covered names' own mean, which is
//     what the weak bucket's spread is measured against. The published study was market-adjusted.
//   - A company with a non-December year end is scored on the December calendar.
// Stands outside the runtime for its reads, like research-vn-supervision.ts: it fetches years the
// refresh never keeps. Opens the database read-only.
import { Database } from 'bun:sqlite'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import type { StatementPayloads } from '@/trading/sources/adapters/vietcap/statements'
import { BROWSER_HEADERS } from '@/core/http-client'
import { utcDay } from '@/core/utils/time'
import { ticker } from '@/trading/kernel/instrument'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { annualReportDeadline } from '@/trading/markets/disclosure-calendar'
import { VN_ACCOUNTS_POLICY } from '@/trading/markets/equity-vn/factor-policy'
import { isAccountsCovered, scoreAccounts } from '@/trading/markets/equity-vn/accounts/score'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { VIETCAP_STATEMENTS_ENDPOINT } from '@/trading/sources/adapters/vietcap/client'
import { buildStatementPath, toFiledAccounts } from '@/trading/sources/adapters/vietcap/statements'

const FIRST_FISCAL_YEAR = 2019
const FORWARD_DAYS = 365
const PRICE_ENDPOINT = 'https://api-finfo.vndirect.com.vn/v4/stock_prices'
const PRICE_FROM_DAY = '2019-01-01'
/** Enough sessions to reach 2019 in one page: about 250 a year. */
const PRICE_PAGE_SIZE = 3000
const REQUEST_TIMEOUT_MS = 15_000
const REQUEST_GAP_MS = 400
/** Vietcap answers a burst with 502s for a minute or so; a dropped name biases the sample. */
const RETRY_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504])
const RETRY_ATTEMPTS = 5
const RETRY_BASE_MS = 5_000
const PROGRESS_EVERY = 50
const M_SCORE_CUTS: readonly number[] = Object.freeze([-1.78, -2.22])
const SCORE_BUCKETS = Object.freeze([
  { label: '0-3', max: 3 },
  { label: '4-6', max: 6 },
  { label: '7-9', max: 9 },
])
/** A sector below this many name-years has no stable weak bucket to compare. */
const MINIMUM_SECTOR_OBSERVATIONS = 100
/** The sector whose report gap this run exists to test. */
const FOCUS_SECTOR = 'real-estate'
const PERCENT_SCALE = 100
const DECIMALS = 2
const EXIT_USAGE = 2

const PRICE_RESPONSE = z.object({
  data: z.array(z.object({ date: z.string(), adClose: z.number() })),
})

interface Close {
  readonly day: string
  readonly close: number
}

/** Per-run state: `requests` counts network reads so a name served from the cache skips the gap. */
interface RunContext {
  readonly today: string
  readonly cacheDir?: string
  requests: number
}

interface CoveredName {
  readonly ticker: string
  readonly sector?: string
}

interface Observation {
  readonly fiscalYear: number
  readonly score: number
  readonly mScore?: number
  readonly forwardReturn: number
  readonly sector?: string
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dbPath = flag(args, 'db')

  if (dbPath === undefined) {
    console.error(
      'usage: bun scripts/research-vn-accounts-score.ts --db=<sqlite> [--limit=N] [--cache=<dir>]'
    )
    process.exit(EXIT_USAGE)
  }

  const names = coveredTickers(dbPath).slice(0, Number(flag(args, 'limit') ?? Infinity))
  const cacheDir = flag(args, 'cache')
  const context: RunContext = {
    today: utcDay(Date.now()),
    ...(cacheDir === undefined ? {} : { cacheDir }),
    requests: 0,
  }
  const observations: Observation[] = []
  let failed = 0

  if (cacheDir !== undefined) {
    await mkdir(cacheDir, { recursive: true })
  }

  for (const [index, name] of names.entries()) {
    const requestsBefore = context.requests

    try {
      observations.push(...(await observe(name, context)))
    } catch (err: unknown) {
      failed += 1
      console.error(`${name.ticker}: ${err instanceof Error ? err.message : String(err)}`)
    }

    if ((index + 1) % PROGRESS_EVERY === 0) {
      console.error(`${index + 1}/${names.length}`)
    }

    if (context.requests > requestsBefore) {
      await Bun.sleep(REQUEST_GAP_MS)
    }
  }

  report(observations, names.length, failed)
}

function flag(args: readonly string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
}

function coveredTickers(dbPath: string): readonly CoveredName[] {
  const db = new Database(dbPath, { readonly: true })

  try {
    const rows = db
      .query<{ ticker: string; sector: string | null }, [string]>(
        `SELECT ticker, sector FROM instruments WHERE market = ? AND kind = 'equity' ` +
          `AND status = 'active' ORDER BY ticker`
      )
      .all(VN_MARKET_REF)

    return rows
      .filter((row) =>
        isAccountsCovered({ kind: 'equity', ...(row.sector === null ? {} : { sector: row.sector }) })
      )
      .map((row) => ({
        ticker: row.ticker,
        ...(row.sector === null ? {} : { sector: row.sector }),
      }))
  } finally {
    db.close()
  }
}

async function observe(name: CoveredName, context: RunContext): Promise<readonly Observation[]> {
  // Different hosts: the price read overlaps the statements without adding load on Vietcap.
  const [statements, closes] = await Promise.all([
    fetchStatements(name.ticker, context),
    fetchCloses(name.ticker, context),
  ])
  const history = toFiledAccounts(
    { market: VN_MARKET_REF, ticker: ticker(name.ticker) },
    statements,
    Date.now()
  ).annual
  const observations: Observation[] = []

  for (let year = FIRST_FISCAL_YEAR; ; year += 1) {
    const decisionDay = shiftCalendarDay(
      annualReportDeadline(year),
      VN_ACCOUNTS_POLICY.finalGraceDays
    )
    const exitDay = shiftCalendarDay(decisionDay, FORWARD_DAYS)

    if (exitDay > context.today) {
      break
    }

    const reading = scoreAccounts(history, decisionDay)
    const forwardReturn = returnBetween(closes, decisionDay, exitDay)

    if (reading !== undefined && forwardReturn !== undefined) {
      observations.push({
        fiscalYear: reading.fiscalYear,
        score: reading.score,
        ...(reading.mScore === undefined ? {} : { mScore: reading.mScore }),
        forwardReturn,
        ...(name.sector === undefined ? {} : { sector: name.sector }),
      })
    }
  }

  return observations
}

async function fetchStatements(name: string, context: RunContext): Promise<StatementPayloads> {
  const base = `${VIETCAP_STATEMENTS_ENDPOINT}${buildStatementPath(name)}?section=`

  return {
    BALANCE_SHEET: await cachedJson(`${base}BALANCE_SHEET`, {}, context),
    INCOME_STATEMENT: await cachedJson(`${base}INCOME_STATEMENT`, {}, context),
    CASH_FLOW: await cachedJson(`${base}CASH_FLOW`, {}, context),
  }
}

/** The provider answers newest first whatever `sort` asks, so the series is sorted here. */
async function fetchCloses(name: string, context: RunContext): Promise<readonly Close[]> {
  const url =
    `${PRICE_ENDPOINT}?q=code:${name}~date:gte:${PRICE_FROM_DAY}` +
    `&size=${PRICE_PAGE_SIZE}&sort=date`
  const rows = PRICE_RESPONSE.parse(await cachedJson(url, {}, context)).data

  return rows
    .filter((row) => row.adClose > 0)
    .map((row) => ({ day: row.date, close: row.adClose }))
    .sort((left, right) => left.day.localeCompare(right.day))
}

/** Only a successful answer is kept, so a failed name is asked again on the next run. */
async function cachedJson(
  url: string,
  headers: Readonly<Record<string, string>>,
  context: RunContext
): Promise<unknown> {
  const path =
    context.cacheDir === undefined
      ? undefined
      : join(context.cacheDir, `${Bun.hash(url).toString(16)}.json`)

  if (path !== undefined && (await Bun.file(path).exists())) {
    return Bun.file(path).json()
  }

  context.requests += 1

  const value = await fetchJson(url, headers)

  if (path !== undefined) {
    await Bun.write(path, JSON.stringify(value))
  }

  return value
}

/** Backs off doubling from `RETRY_BASE_MS` on a throttle or gateway answer, never on a 4xx refusal. */
async function fetchJson(url: string, headers: Readonly<Record<string, string>>): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, {
      headers: { ...BROWSER_HEADERS, ...headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (response.ok) {
      return response.json()
    }

    if (!RETRY_STATUSES.has(response.status) || attempt >= RETRY_ATTEMPTS) {
      throw new Error(`${url} answered ${response.status} after ${attempt} attempt(s)`)
    }

    await Bun.sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
  }
}

function returnBetween(closes: readonly Close[], fromDay: string, toDay: string): number | undefined {
  const entry = closes.find((close) => close.day >= fromDay)
  const exit = closes.find((close) => close.day >= toDay)

  return entry === undefined || exit === undefined ? undefined : exit.close / entry.close - 1
}

function report(observations: readonly Observation[], asked: number, failed: number): void {
  console.log(`names ${asked}, failed ${failed}, name-years scored ${observations.length}`)

  const years = [...new Set(observations.map((entry) => entry.fiscalYear))].sort()

  for (const year of years) {
    printBuckets(`FY${year}`, observations.filter((entry) => entry.fiscalYear === year))
  }

  printBuckets('pooled', observations)

  for (const cut of M_SCORE_CUTS) {
    printMScore(cut, observations)
  }

  printSectorSpreads(observations)
}

function printSectorSpreads(observations: readonly Observation[]): void {
  const sectors = new Map<string, Observation[]>()

  for (const row of observations) {
    const key = row.sector ?? 'unknown'
    const rows = sectors.get(key) ?? []

    rows.push(row)
    sectors.set(key, rows)
  }

  for (const [sector, rows] of [...sectors].sort(([a], [b]) => a.localeCompare(b))) {
    if (rows.length >= MINIMUM_SECTOR_OBSERVATIONS) {
      printBuckets(`sector ${sector}`, rows)
      printYears(sector, rows)
    }
  }

  printBuckets(
    `not ${FOCUS_SECTOR}`,
    observations.filter((row) => row.sector !== FOCUS_SECTOR)
  )
}

/** A sector's pooled spread can be one year's swing; the keep-rule reads it year by year. */
function printYears(sector: string, rows: readonly Observation[]): void {
  const years = [...new Set(rows.map((row) => row.fiscalYear))].sort()

  for (const year of years) {
    printBuckets(`  ${sector} FY${year}`, rows.filter((row) => row.fiscalYear === year))
  }
}

function printBuckets(label: string, rows: readonly Observation[]): void {
  const cells = SCORE_BUCKETS.map((bucket, index) => {
    const floor = index === 0 ? -1 : (SCORE_BUCKETS[index - 1]?.max ?? -1)
    const members = rows.filter((row) => row.score > floor && row.score <= bucket.max)

    return `${bucket.label} n=${members.length} ${percent(mean(members))}`
  })
  const weak = rows.filter((row) => row.score <= VN_ACCOUNTS_POLICY.weakAtScore)
  const rest = rows.filter((row) => row.score > VN_ACCOUNTS_POLICY.weakAtScore)
  const spread = percent(mean(weak) - mean(rest))

  console.log(`${label}: ${cells.join(' | ')} | all ${percent(mean(rows))} | weak-rest ${spread}`)
}

function printMScore(cut: number, rows: readonly Observation[]): void {
  const scored = rows.filter((row) => row.mScore !== undefined)
  const flagged = scored.filter((row) => (row.mScore ?? cut) > cut)
  const clean = scored.filter((row) => (row.mScore ?? cut) <= cut)
  const rate = scored.length === 0 ? 0 : flagged.length / scored.length

  console.log(
    `M > ${cut}: ${flagged.length}/${scored.length} (${percent(rate)}) | ` +
      `flagged ${percent(mean(flagged))} vs clean ${percent(mean(clean))}`
  )
}

function mean(rows: readonly Observation[]): number {
  return rows.length === 0
    ? Number.NaN
    : rows.reduce((sum, row) => sum + row.forwardReturn, 0) / rows.length
}

function percent(value: number): string {
  return Number.isFinite(value) ? `${(value * PERCENT_SCALE).toFixed(DECIMALS)}%` : '-'
}

await main()
