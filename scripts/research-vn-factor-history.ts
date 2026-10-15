#!/usr/bin/env bun
// Which VN factors ranked the board over the last year or two? Seeds a copy of the book with the
// history the refresh never keeps - older adjusted bars, the ratio history as it stood on each
// board day, the flows before the stored window - then screens every `--step`th session with the
// live scorer and holds each name's return over the long outcome window against the VN-Index's.
//
// Usage:
//   bun scripts/research-vn-factor-history.ts --data-dir=/private/tmp/oa-factors
//   bun scripts/research-vn-factor-history.ts --data-dir=<dir> --from=2025-01-02 --step=5
//   bun scripts/research-vn-factor-history.ts --data-dir=<dir> --skip-seed   # rerun on the seeded copy
//
// The book is copied into `--data-dir/data` on the first run and never opened for writing.
// Read it as a shape, not a return:
//   - Survivorship: the names are today's listings, under today's supervision and float.
//   - Restatement lookahead: the ratio endpoint serves a quarter's newest figures from the day it
//     was first filed, and a quarter with no filing stamp from its statutory deadline.
//   - Boards a holding window apart are the only independent ones; a year is about four.
// Nothing here is written to the operator's book or to `factor_log`.
import { Database } from 'bun:sqlite'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { Booted } from '@/app/api'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import { boot } from '@/app/api'
import { utcDay } from '@/core/utils/time'
import { outcomeWindowSessions } from '@/trading/features/suggestion/pipeline/outcome-window'
import { ticker, tradingDay } from '@/trading/kernel/instrument'
import { createTradingCalendar } from '@/trading/markets/calendar'
import {
  VN_CALENDAR,
  VN_EVIDENCE_SESSIONS,
  VN_INDEX_TICKER,
  VN_MARKET_REF,
} from '@/trading/markets/equity-vn/policy'
import { measureBoards, report } from './research-vn-factor-history/measure'
import { seedBars, seedFlows, seedFundamentals } from './research-vn-factor-history/seed'

const DEFAULT_FROM = '2025-01-02'
const DEFAULT_STEP = 5
const DEFAULT_CONFIG = './config.toml'
const DEFAULT_BOOK = join(process.env.HOME ?? '', '.openalpha', 'data', 'openalpha.sqlite')
const BOOK_FILE = 'openalpha.sqlite'
const EXIT_USAGE = 2

interface Options {
  readonly dataDir: string
  readonly book: string
  readonly from: TradingDay
  readonly step: number
  readonly config: string
  readonly seed: boolean
}

interface StoredFrom {
  readonly bars: TradingDay
  readonly flows: TradingDay
  readonly fundamentals: TradingDay
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))

  if (options === undefined) {
    console.error(
      'usage: bun scripts/research-vn-factor-history.ts --data-dir=<dir> ' +
        '[--book=<sqlite>] [--from=YYYY-MM-DD] [--step=N] [--config=<toml>] [--skip-seed]'
    )
    process.exitCode = EXIT_USAGE

    return
  }

  const copy = await prepareCopy(options)
  // Read off the book, not the copy, so a seed that stopped part-way is resumed rather than read
  // as a series that already reaches back.
  const stored = storedFromOf(options.book)
  const booted = await boot({
    mode: 'cli',
    startup: 'migrate',
    env: process.env,
    configFile: 'required',
    shutdownSignal: new AbortController().signal,
    configPath: options.config,
    dataDir: options.dataDir,
  })

  try {
    await assertWritesCopy(booted, copy)
    await run(booted, options, stored)
  } finally {
    await booted.dispose()
  }
}

async function run(booted: Booted, options: Options, stored: StoredFrom): Promise<void> {
  const calendar = createTradingCalendar(VN_CALENDAR)
  const horizon = outcomeWindowSessions(VN_CALENDAR, 'long')
  const names = await namesOf(booted)
  const base = {
    booted,
    calendar,
    names,
    storedFrom: stored.bars,
    historyFrom: calendar.addTradingDays(options.from, -VN_EVIDENCE_SESSIONS),
  }

  if (options.seed) {
    await seedBars({ ...base, boards: [] })
  }

  const sessions = await sessionsOf(booted, base.historyFrom)
  const first = sessions.findIndex((day) => day >= options.from)
  const boards = sessions.filter(
    (_, index) =>
      first >= 0 &&
      index >= first &&
      (index - first) % options.step === 0 &&
      index + horizon < sessions.length
  )

  if (options.seed) {
    await seedFundamentals({ ...base, boards }, stored.fundamentals)
    await seedFlows({ ...base, boards }, stored.flows)
  }

  const measured = await measureBoards({ booted, sessions, boards, horizon })

  report(measured, Math.ceil(horizon / options.step))
}

async function namesOf(booted: Booted): Promise<readonly InstrumentRef[]> {
  const { app } = booted
  const listed = await app.resolve('tradingStores').marketData.listInstruments({
    market: VN_MARKET_REF,
    kind: 'equity',
    signal: app.signal,
  })

  return [
    { market: VN_MARKET_REF, ticker: ticker(VN_INDEX_TICKER) },
    ...listed.map((record) => record.instrument),
  ]
}

async function sessionsOf(booted: Booted, fromDay: TradingDay): Promise<readonly TradingDay[]> {
  const { app } = booted

  return await app.resolve('tradingStores').marketData.listSessionDays({
    market: VN_MARKET_REF,
    fromDay,
    toDay: tradingDay(utcDay(Date.now())),
    signal: app.signal,
  })
}

/** The working copy, made on the first run only through SQLite's own backup, so a book a running
 *  daemon holds in WAL is copied whole. A data dir that holds the book itself is refused: every seed
 *  below writes, and none of it may reach the operator's history. */
async function prepareCopy(options: Options): Promise<string> {
  const target = join(options.dataDir, 'data', BOOK_FILE)
  const book = await realpath(options.book)

  await mkdir(dirname(target), { recursive: true })

  const copyDir = await realpath(dirname(target))

  if (copyDir === dirname(book)) {
    throw new Error(`--data-dir must not hold the book itself: ${book}`)
  }

  if (!(await Bun.file(target).exists())) {
    const source = new Database(book, { readwrite: true })

    try {
      source.run('VACUUM INTO ?', [target])
    } finally {
      source.close()
    }
  }

  return target
}

/** Every seed writes, so the run stops unless the book it booted is the copy it made. */
async function assertWritesCopy(booted: Booted, copy: string): Promise<void> {
  const opened = await realpath(join(booted.app.config.paths.dataDir, 'data', BOOK_FILE))

  if (opened !== (await realpath(copy))) {
    throw new Error(`booted ${opened}, not the copy ${copy}`)
  }
}

/** Where the stored series begin, read before boot so the seed knows what not to overwrite. */
function storedFromOf(path: string): StoredFrom {
  const db = new Database(path, { readwrite: true })

  try {
    db.run('PRAGMA query_only = 1')

    return {
      bars: firstDay(db, 'daily_bars', 'day'),
      flows: firstDay(db, 'foreign_flow_snapshots', 'day'),
      fundamentals: firstDay(db, 'fundamental_snapshots', 'as_of'),
    }
  } finally {
    db.close()
  }
}

function firstDay(db: Database, table: string, column: string): TradingDay {
  const row = db
    .query<{ readonly day: string | null }, [string]>(
      `SELECT MIN(${column}) AS day FROM ${table} WHERE market = ?`
    )
    .get(VN_MARKET_REF)

  return tradingDay(row?.day ?? utcDay(Date.now()))
}

function parseOptions(args: readonly string[]): Options | undefined {
  const dataDir = flag(args, 'data-dir')
  const step = Number(flag(args, 'step') ?? DEFAULT_STEP)

  if (dataDir === undefined || !Number.isInteger(step) || step <= 0) {
    return undefined
  }

  return {
    dataDir: resolve(dataDir),
    book: flag(args, 'book') ?? DEFAULT_BOOK,
    from: tradingDay(flag(args, 'from') ?? DEFAULT_FROM),
    step,
    config: flag(args, 'config') ?? DEFAULT_CONFIG,
    seed: !args.includes('--skip-seed'),
  }
}

function flag(args: readonly string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
}

await main()
