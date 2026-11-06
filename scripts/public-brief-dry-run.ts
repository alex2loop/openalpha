#!/usr/bin/env bun
// Dry run of the public brief: what it would publish, without publishing.
//
// Usage:
//   bun scripts/public-brief-dry-run.ts --list-kinds
//
// --list-kinds prints every brief section kind with its book/market scope, the toggle group that
// can pull it, and whether it publishes with every toggle on.
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

const USAGE = 'usage: bun scripts/public-brief-dry-run.ts --list-kinds'
const ALL_ON = Object.freeze({ analysis: true, headlines: true })
const ANALYSIS_OFF = Object.freeze({ analysis: false, headlines: true })

if (process.argv.includes('--list-kinds')) {
  listKinds()
} else {
  console.error(USAGE)
  process.exit(1)
}

function listKinds(): void {
  const published = publicSectionKinds(ALL_ON)
  const width = Math.max(...BRIEF_SECTION_ORDER.map((kind) => kind.length))

  for (const kind of BRIEF_SECTION_ORDER) {
    const scope = BRIEF_SECTION_SCOPE[kind]
    const group = groupOf(kind)
    const state = published.has(kind) ? 'published' : '-'

    console.log(`${kind.padEnd(width)}  ${scope.padEnd(6)}  ${group.padEnd(9)}  ${state}`)
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
