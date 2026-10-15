import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { ScoredRow } from '@/trading/features/suggestion/pipeline/attribution'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type {
  FactorLogService,
  ResolvedFactorLogEntry,
} from '@/trading/features/suggestion/track-record/factor-log-types'
import { t } from '@/i18n'
import { summarizeFactorAttribution } from '@/trading/features/suggestion/pipeline/attribution'
import { OUTCOME_WINDOW_DAYS } from '@/trading/features/suggestion/pipeline/outcome-window'
import { MINIMUM_TRACK_RECORD_SAMPLE } from '@/trading/features/suggestion/pipeline/reporting'
import {
  type ReflectSections,
  renderReflectText,
} from '@/trading/features/suggestion/track-record/render'
import { formatCount, SECTION_ICONS } from '@/trading/render/format'
import { renderEmptyLine } from '@/trading/render/layout'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

/** An empty state is a rendered section like any other, so it carries its icon — the way `/alert`
 *  and `/watchlist` already render theirs. The key stays in `messageKeys` so registration keeps
 *  requiring both translations. */
const EMPTY_KEY = 'slash.tradingReflectEmpty'

/** `role: 'operator'`: a track record grades the operator's own suggestions. Reading stored outcomes
 *  spends no LLM budget, so this is a `read` like `/portfolio`, not the `costly` of `/suggest`. */
interface ReflectCommandDeps {
  readonly suggestions: Pick<SuggestionService, 'reflect' | 'focusRecords'>
  readonly factorLog: Pick<FactorLogService, 'listResolved'>
}

export function createReflectCommand(deps: ReflectCommandDeps): SlashCommand {
  return {
    name: 'reflect',
    description: { kind: 'localized', key: 'slash.tradingReflectHelp' },
    messageKeys: [EMPTY_KEY],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'read',
    },
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: ReflectCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const { report, factorRows, acted } = await deps.suggestions.reflect({
    limit: SURFACE_LIMITS.maximumTrackRecordItems,
    signal: ctx.signal,
  })
  const board = await deps.factorLog.listResolved({
    limit: SURFACE_LIMITS.maximumFactorLogItems,
    signal: ctx.signal,
  })
  const boardAttribution = summarizeFactorAttribution(
    board.map(toScoredRow),
    MINIMUM_TRACK_RECORD_SAMPLE
  )

  // The empty line is only for a book with no calls at all: one with calls and no outcomes still
  // has its coverage to report.
  if (
    report.summary.resolvedCount === 0 &&
    report.summary.coverage.actionable === 0 &&
    boardAttribution.length === 0
  ) {
    return {
      kind: 'text',
      text: renderEmptyLine(
        SECTION_ICONS.reflect,
        t(ctx.locale, EMPTY_KEY, {
          short: formatCount(ctx.locale, OUTCOME_WINDOW_DAYS.short),
          long: formatCount(ctx.locale, OUTCOME_WINDOW_DAYS.long),
        })
      ),
    }
  }

  // The rows `summarize` already read, so the factor breakdown costs no second query.
  const attribution = summarizeFactorAttribution(factorRows, MINIMUM_TRACK_RECORD_SAMPLE)
  const sections: ReflectSections = {
    attribution,
    boardAttribution,
    focuses: await deps.suggestions.focusRecords({ signal: ctx.signal }),
    stoppedCount: board.filter((entry) => entry.outcome.exitReason === 'stopped-trading').length,
    ...(acted === undefined ? {} : { acted }),
  }

  return {
    kind: 'text',
    text: renderReflectText(ctx.locale, report, sections),
  }
}

function toScoredRow(entry: ResolvedFactorLogEntry): ScoredRow {
  return {
    market: entry.instrument.market,
    strategyVersion: entry.strategyVersion,
    factorScores: entry.factors,
    longReturnPct: entry.outcome.returnPct,
  }
}
