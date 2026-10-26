import type { RunId, SessionId } from '@/core/ids'
import type {
  CommandMessage,
  CommandMessageKey,
  SlashCommand,
  SlashResult,
} from '@/core/types/command'
import type {
  CostRange,
  DaySpend,
  LLMUsageTotals,
  RunCalls,
  SpendBreakdownRow,
} from '@/core/types/usage'
import { formatUsd } from '@/core/utils/cost'

const MESSAGE_KEYS: readonly CommandMessageKey[] = [
  'slash.costTitle',
  'slash.costLine',
  'slash.costLineUncapped',
  'slash.costSession',
]

interface JobSpend {
  readonly kind: 'command' | 'agent'
  readonly name: string
  readonly runs: number
  readonly costUsd: number
}

export interface JobsSpend {
  readonly jobs: readonly JobSpend[]
  readonly otherUsd: number
}

/** The one spend source every surface reads, so the CLI and a channel answer with the same number. */
export interface SpendReader {
  /** Global spend for the calendar day or month containing `nowMs`. */
  forPeriod(period: 'day' | 'month', nowMs: number): Promise<number>
  /** Global spend over an inclusive day range. */
  forRange(range: CostRange): Promise<number>
  /** Per calendar day, oldest first, zero days included. */
  dailyForRange(range: CostRange): Promise<readonly DaySpend[]>
  /** Where `forPeriod`'s total went, per agent and model, most expensive first. */
  breakdownForPeriod(period: 'day' | 'month', nowMs: number): Promise<readonly SpendBreakdownRow[]>
  /** Where `forRange`'s total went, per agent and model, most expensive first. */
  breakdownForRange(range: CostRange): Promise<readonly SpendBreakdownRow[]>
  /** Where `forRange`'s total went, per top-level run's job, costliest first; `otherUsd` is the
   *  attempts whose top-level run has no run row, so the jobs and it add up to that total. */
  jobsForRange(range: CostRange): Promise<JobsSpend>
  /** Everything one session has accumulated — what `/cost` reports and a run footer prints. */
  forSession(sessionId: SessionId): Promise<LLMUsageTotals>
  /** One run's attempts and everything beneath it, newest first, at most `limit`, with the totals
   *  of all of them: every billed call, a billed search and each retried attempt included. */
  callsForRun(runId: RunId, limit: number): Promise<RunCalls>
}

export interface SpendCommandDeps {
  readonly reader: SpendReader
  readonly maxDailyUsd: number
}

export function createCostCommand(deps: SpendCommandDeps): SlashCommand {
  return {
    name: 'cost',
    description: { kind: 'localized', key: 'slash.costHelp' },
    messageKeys: [...MESSAGE_KEYS],
    policy: { surfaces: ['channel', 'repl'], role: 'member', action: 'read' },
    run: async (ctx): Promise<SlashResult> => {
      const nowMs = Date.now()
      const [spent, session] = await Promise.all([
        deps.reader.forPeriod('day', nowMs),
        deps.reader.forSession(ctx.sessionId),
      ])

      return {
        kind: 'message',
        title: { key: 'slash.costTitle' },
        messages: [toDailyLine(spent, deps.maxDailyUsd), toSessionLine(session)],
      }
    },
  }
}

function toDailyLine(spent: number, maxDailyUsd: number): CommandMessage {
  const spentUsd = formatUsd(spent)

  if (maxDailyUsd <= 0) {
    return { key: 'slash.costLineUncapped', values: { spent: spentUsd } }
  }

  return {
    key: 'slash.costLine',
    values: {
      spent: spentUsd,
      max: formatUsd(maxDailyUsd),
      pct: Math.round((spent / maxDailyUsd) * 100),
    },
  }
}

function toSessionLine(session: LLMUsageTotals): CommandMessage {
  return {
    key: 'slash.costSession',
    values: {
      input: session.inputTokens,
      output: session.outputTokens,
      cost: formatUsd(session.costUsd),
    },
  }
}
