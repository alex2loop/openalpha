#!/usr/bin/env bun
// Dry run of the public brief: what it would publish, without publishing.
//
// Usage:
//   bun scripts/public-brief-dry-run.ts --list-kinds
//   bun scripts/public-brief-dry-run.ts --data-dir=<copy> [--config=<file>] [--out=<file>] [--now=<ISO>]
//   PUBLIC_BRIEF_TOKEN=<token> bun scripts/public-brief-dry-run.ts --data-dir=<copy> --tick \
//     --post=<url> [--now=<ISO>]
//
// --list-kinds prints every brief section kind with its book/market scope, the toggle group that
// can pull it, and whether it publishes with every toggle on.
//
// --data-dir builds the day's brief on a copy of the data (a `.backup` of the database, never the
// live directory) with the copy's own config: it refreshes the public markets as the daemon would,
// saves the day's row in the copy and prints each section with the sources it cites. The config is
// read from the copy unless --config names one. No model key is passed, so no model can be called.
// The guard then judges the render against the copy's book and exits 3 when it refuses.
// --out writes the rendered brief as JSON. --now builds as of that instant, so two consecutive days
// run one after the other show what changed from the first to the second.
//
// --tick runs the daemon's own public brief tick once, as if it were --now, on the copy: the same
// build, render, guard and publisher, posting to --post, which is only an https:// address or
// http://localhost:<port>. It prints the day's row afterwards. The token is read from the
// environment, so use a throwaway one against a local Worker, never the real one.
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import type { Logger } from '@/core/logging/logger'
import type { PublicBriefCredential } from '@/trading/api'
import type {
  PublicBriefStore,
  PublicScreen,
} from '@/trading/features/brief/public/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { BriefSectionKind, BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import { boot } from '@/app/boot'
import { resolveBootExtensions } from '@/app/config-tree'
import { createPublicBriefPublisher } from '@/app/public-brief-publisher'
import { registerKnownSecret, resolveCredential } from '@/core/security/credentials'
import { createPublicBriefGuard, PUBLIC_BRIEF_TOKEN_VARIABLE } from '@/trading/api'
import { PUBLIC_HOME_MARKET } from '@/trading/features/brief/public/reads'
import {
  PUBLIC_ANALYSIS_KINDS,
  PUBLIC_ANALYSIS_STORIES,
  PUBLIC_HEADLINE_KINDS,
  publicSectionKinds,
  publicStoryOmits,
} from '@/trading/features/brief/public/scope'
import { PUBLIC_BRIEF_SCHEMA } from '@/trading/features/brief/public/store'
import { createPublicBriefTick } from '@/trading/features/brief/public/tick'
import { BRIEF_SECTION_ORDER } from '@/trading/kernel/operator/brief-section'
import { BRIEF_SECTION_SCOPE } from '@/trading/kernel/operator/brief-section-scope'
import { vnManifest } from '@/trading/markets/equity-vn/market'

const COLUMN_GAP = '  '
const USAGE =
  'usage: bun scripts/public-brief-dry-run.ts --list-kinds | ' +
  '--data-dir=<copy> [--config=<file>] [--out=<file>] [--now=<ISO>] [--tick --post=<url>]'
const ALL_ON = Object.freeze({ analysis: true, headlines: true })
const ANALYSIS_OFF = Object.freeze({ analysis: false, headlines: true })
const DRY_RUN_TIMEOUT_MS = 300_000
const CONFIG_FILE = 'config.toml'
const EXIT_NO_BRIEF = 2
const EXIT_REFUSED = 3
const LOCAL_POST_HOST = 'localhost'

const { values } = parseArgs({
  options: {
    'list-kinds': { type: 'boolean' },
    'data-dir': { type: 'string' },
    config: { type: 'string' },
    out: { type: 'string' },
    now: { type: 'string' },
    post: { type: 'string' },
    tick: { type: 'boolean' },
  },
})

if (values['list-kinds'] === true) {
  listKinds()
} else if (values['data-dir'] !== undefined && (values.tick === true) === (values.post !== undefined)) {
  process.exitCode = await dryRun(values['data-dir'])
} else {
  console.error(USAGE)
  process.exit(1)
}

function listKinds(): void {
  const published = publicSectionKinds(ALL_ON)
  const rows = BRIEF_SECTION_ORDER.map((kind) => [
    kind,
    BRIEF_SECTION_SCOPE[kind],
    groupOf(kind),
    published.has(kind) ? 'published' : '-',
  ])
  const widths = [0, 1, 2].map((column) => Math.max(...rows.map((row) => row[column]?.length ?? 0)))

  for (const row of rows) {
    console.log(
      row
        .map((cell, column) => (column === 3 ? cell : cell.padEnd(widths[column] ?? 0)))
        .join(COLUMN_GAP)
    )
  }

  console.log(`analysis stories: ${PUBLIC_ANALYSIS_STORIES.join(', ')}`)
  console.log(`stories omitted, analysis on: ${listOf(publicStoryOmits(ALL_ON))}`)
  console.log(`stories omitted, analysis off: ${listOf(publicStoryOmits(ANALYSIS_OFF))}`)
}

function groupOf(kind: BriefSectionKind): string {
  if (PUBLIC_ANALYSIS_KINDS.some((member) => member === kind)) {
    return 'analysis'
  }

  return PUBLIC_HEADLINE_KINDS.some((member) => member === kind) ? 'headlines' : '-'
}

function listOf(members: ReadonlySet<string>): string {
  return members.size === 0 ? 'none' : [...members].join(', ')
}

interface TickTarget {
  readonly origin: string
  readonly credential: PublicBriefCredential
}

interface DryRunParts {
  readonly services: TradingServices
  readonly logger: Logger
  readonly store: PublicBriefStore
  readonly trading: TradingConfig
}

/** A kept section per line with the sources it cites, then the sources the whole brief cites. */
async function dryRun(dataDir: string): Promise<number> {
  const target = values.tick === true ? tickTarget() : undefined

  if (values.tick === true && target === undefined) {
    return 1
  }

  const signal = AbortSignal.timeout(DRY_RUN_TIMEOUT_MS)
  // Nothing from the shell reaches the run: no model key, no source key.
  const booted = await boot({
    mode: 'cli',
    env: {},
    dataDir,
    configPath: values.config ?? join(dataDir, CONFIG_FILE),
    shutdownSignal: signal,
  })

  try {
    const parts = {
      services: booted.app.resolve('tradingServices'),
      logger: booted.app.resolve('logger'),
      store: booted.app.resolve('tradingStores').publicBrief,
      trading: resolveBootExtensions(booted.app.config).trading,
    }

    return target === undefined
      ? await buildAndPrint(parts, signal)
      : await tickOnce(parts, target, signal)
  } finally {
    await booted.dispose()
  }
}

/** The address and the token a tick posts with. Either one missing or refused ends the run before
 *  anything is built. */
function tickTarget(): TickTarget | undefined {
  const origin = originOf(values.post ?? '')
  const token = resolveCredential(process.env, PUBLIC_BRIEF_TOKEN_VARIABLE)

  if (origin === undefined) {
    console.error('--post takes https://<host> or http://localhost:<port>')

    return undefined
  }

  if (token === undefined) {
    console.error(`${PUBLIC_BRIEF_TOKEN_VARIABLE} is not set`)

    return undefined
  }

  registerKnownSecret(token)

  return { origin, credential: { token } }
}

function originOf(address: string): string | undefined {
  try {
    const url = new URL(address)
    const isLocal = url.protocol === 'http:' && url.hostname === LOCAL_POST_HOST
    const isBare =
      url.username === '' && url.password === '' && url.pathname === '/' && url.search === ''

    return (url.protocol === 'https:' || isLocal) && isBare && url.hash === ''
      ? url.origin
      : undefined
  } catch {
    return undefined
  }
}

/** The daemon's own tick, once, with the clock held at --now: an attempt is stamped at that instant,
 *  so a run at --now plus five minutes finds the retry due however long the first one took. */
async function tickOnce(
  parts: DryRunParts,
  target: TickTarget,
  signal: AbortSignal
): Promise<number> {
  const { services, logger, store, trading } = parts
  const now = instantOf()

  if (Number.isNaN(now)) {
    console.error(`bad --now ${values.now}`)

    return 1
  }

  const calendar = vnManifest(trading).calendar
  const guard = createPublicBriefGuard(services, logger)

  Date.now = () => now
  await createPublicBriefTick({
    calendar,
    publishTime: trading.publicBrief.publishTime,
    store,
    publisher: createPublicBriefPublisher(target.credential, target.origin),
    logger,
    build: (input) => services.publicBrief.build(input),
    render: (row) => services.publicBrief.render(row),
    judge: (row, render, judged) => guard.judge(row, render, judged),
  })(signal)

  const day = calendar.dayAt(now)
  const row = await store.find(day, signal)

  console.log(`${day}: attempts ${row?.attempts ?? 0}, ${row?.publishedAt === undefined ? 'open' : 'published'}`)

  return 0
}

function instantOf(): number {
  return values.now === undefined ? Date.now() : Date.parse(values.now)
}

async function buildAndPrint(
  { services, logger }: DryRunParts,
  signal: AbortSignal
): Promise<number> {
  const now = instantOf()
  const day = Number.isNaN(now)
    ? undefined
    : services.marketData.marketDay(PUBLIC_HOME_MARKET, now)?.today

  if (day === undefined) {
    console.error(`no ${PUBLIC_HOME_MARKET} day at ${values.now ?? now}`)

    return 1
  }

  const row = await services.publicBrief.build({ day, now, signal })

  if (row === null) {
    console.error(`${day}: nothing worth publishing`)

    return EXIT_NO_BRIEF
  }

  printSections(row.sections)
  printScreens(row.screens ?? [])

  const render = services.publicBrief.render(row)

  if (values.out !== undefined) {
    await Bun.write(values.out, JSON.stringify({ schema: PUBLIC_BRIEF_SCHEMA, ...render }, null, 2))
  }

  console.log(`${render.day}: ${render.headline.vi}`)

  const verdict = await createPublicBriefGuard(services, logger).judge(row, render, signal)

  if (verdict.kind === 'refuse') {
    console.error(`guard refused: ${verdict.leaked.join(', ') || 'book unread'}`)

    return EXIT_REFUSED
  }

  console.log('guard: publish')

  return 0
}

function printScreens(screens: readonly PublicScreen[]): void {
  for (const screen of screens) {
    console.log(['screen', screen.market, `${screen.rows.en.length} names`].join(COLUMN_GAP))
  }
}

function printSections(sections: readonly BriefSectionResult[]): void {
  const sources = new Set<string>()

  for (const section of sections) {
    const cited = section.status === 'ready' ? section.provenance.map((entry) => entry.sourceId) : []

    cited.forEach((source) => sources.add(source))
    console.log(
      [section.kind, section.market ?? '-', section.status, cited.join(',') || '-'].join(COLUMN_GAP)
    )
  }

  console.log(`sources: ${[...sources].sort().join(', ')}`)
}
