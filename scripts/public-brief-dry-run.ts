#!/usr/bin/env bun
// Dry run of the public brief: what it would publish, without publishing.
//
// Usage:
//   bun scripts/public-brief-dry-run.ts --list-kinds
//
// --list-kinds prints every brief section kind with its book/market scope, the toggle group that
// can pull it, and whether it publishes with every toggle on.
import { parseArgs } from 'node:util'

import {
  PUBLIC_ANALYSIS_KINDS,
  PUBLIC_ANALYSIS_STORIES,
  PUBLIC_HEADLINE_KINDS,
  publicSectionKinds,
  publicStoryOmits,
} from '@/trading/features/brief/public/scope'
import type { BriefSectionKind } from '@/trading/kernel/operator/brief-section'
import { BRIEF_SECTION_ORDER } from '@/trading/kernel/operator/brief-section'
import { BRIEF_SECTION_SCOPE } from '@/trading/kernel/operator/brief-section-scope'

const COLUMN_GAP = '  '
const USAGE = 'usage: bun scripts/public-brief-dry-run.ts --list-kinds'
const ALL_ON = Object.freeze({ analysis: true, headlines: true })
const ANALYSIS_OFF = Object.freeze({ analysis: false, headlines: true })

const { values } = parseArgs({ options: { 'list-kinds': { type: 'boolean' } } })

if (values['list-kinds'] === true) {
  listKinds()
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
      row.map((cell, column) => (column === 3 ? cell : cell.padEnd(widths[column] ?? 0))).join(COLUMN_GAP)
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
