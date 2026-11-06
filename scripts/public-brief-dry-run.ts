#!/usr/bin/env bun
// Dry run of the public brief: what it would publish, without publishing.
//
// Usage:
//   bun scripts/public-brief-dry-run.ts --list-kinds
//   bun scripts/public-brief-dry-run.ts --data-dir=<copy> [--config=<file>] [--out=<file>] [--now=<ISO>]
//
// --list-kinds prints every brief section kind with its book/market scope, the toggle group that
// can pull it, and whether it publishes with every toggle on.
//
// --data-dir builds the day's brief on a copy of the data (a `.backup` of the database, never the
// live directory) with the copy's own config: it refreshes the public markets as the daemon would,
// saves the day's row in the copy and prints each section with the sources it cites. The config is
// read from the copy unless --config names one. No model key is passed, so no model can be called.
// --out writes the rendered brief as JSON. --now builds as of that instant, so two consecutive days
// run one after the other show what changed from the first to the second.
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import type { PublicScreen } from '@/trading/features/brief/public/types'
import type { BriefSectionKind, BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import { boot } from '@/app/boot'
import { PUBLIC_HOME_MARKET } from '@/trading/features/brief/public/reads'
import {
  PUBLIC_ANALYSIS_KINDS,
  PUBLIC_ANALYSIS_STORIES,
  PUBLIC_HEADLINE_KINDS,
  publicSectionKinds,
  publicStoryOmits,
} from '@/trading/features/brief/public/scope'
import { PUBLIC_BRIEF_SCHEMA } from '@/trading/features/brief/public/store'
import { BRIEF_SECTION_ORDER } from '@/trading/kernel/operator/brief-section'
import { BRIEF_SECTION_SCOPE } from '@/trading/kernel/operator/brief-section-scope'

const COLUMN_GAP = '  '
const USAGE =
  'usage: bun scripts/public-brief-dry-run.ts --list-kinds | ' +
  '--data-dir=<copy> [--config=<file>] [--out=<file>] [--now=<ISO>]'
const ALL_ON = Object.freeze({ analysis: true, headlines: true })
const ANALYSIS_OFF = Object.freeze({ analysis: false, headlines: true })
const DRY_RUN_TIMEOUT_MS = 300_000
const CONFIG_FILE = 'config.toml'
const EXIT_NO_BRIEF = 2

const { values } = parseArgs({
  options: {
    'list-kinds': { type: 'boolean' },
    'data-dir': { type: 'string' },
    config: { type: 'string' },
    out: { type: 'string' },
    now: { type: 'string' },
  },
})

if (values['list-kinds'] === true) {
  listKinds()
} else if (values['data-dir'] !== undefined) {
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

/** A kept section per line with the sources it cites, then the sources the whole brief cites. */
async function dryRun(dataDir: string): Promise<number> {
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
    return await buildAndPrint(booted.app.resolve('tradingServices'), signal)
  } finally {
    await booted.dispose()
  }
}

async function buildAndPrint(services: TradingServices, signal: AbortSignal): Promise<number> {
  const now = values.now === undefined ? Date.now() : Date.parse(values.now)
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
