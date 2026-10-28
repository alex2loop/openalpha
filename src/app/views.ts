import type { DeliveryHub } from '@/app/delivery'
import type { ChannelDefinition } from '@/channels/api'
import type {
  ChannelHealth,
  ConfigSummaryReader,
  HealthCode,
  HealthSummaryReader,
  JobsSpend,
  SpendReader,
} from '@/commands/api'
import type { ChannelId } from '@/core/channels'
import type { App } from '@/core/container'
import type {
  LLMUsageTotals,
  RootRunCostRow,
  RunAttempt,
  RunCalls,
  SpendBreakdownRow,
} from '@/core/types/usage'

// A corrupt persisted row must not render as a nonsense balance.
const MAX_PERSISTED_USAGE_VALUE = Number.MAX_SAFE_INTEGER

// Reads the attempt ledger, never the process-local cost tracker: the CLI and the daemon are
// separate processes and only the ledger is visible to both.
export function createSpendReader(app: App): SpendReader {
  const attempts = app.resolve('llmAttemptStore')
  const sessionTotals = app.resolve('priorTotals')

  return {
    forPeriod: async (period, nowMs) => boundedUsage(await attempts.totalFor(period, nowMs)),
    forRange: async (range) => boundedUsage(await attempts.totalRange(range)),
    dailyForRange: async (range) =>
      (await attempts.dailyRange(range)).map((spend) => ({
        day: spend.day,
        costUsd: boundedUsage(spend.costUsd),
      })),
    forSession: async (sessionId) => boundedTotals(await sessionTotals(sessionId)),
    breakdownForPeriod: async (period, nowMs) =>
      (await attempts.breakdownFor(period, nowMs)).map(boundedBreakdownRow),
    breakdownForRange: async (range) =>
      (await attempts.breakdownRange(range)).map(boundedBreakdownRow),
    jobsForRange: async (range) => toJobsSpend(await attempts.rootRunsForRange(range)),
    callsForRun: async (id, limit) => boundedCalls(await attempts.attemptsForRun(id, limit)),
  }
}

// The same configured-channel list `/health` reports, so the two commands never disagree about
// which channels exist.
export function createConfigSummary(app: App): ConfigSummaryReader {
  return {
    read: () => ({
      locale: app.config.locale.language,
      timezone: app.config.locale.timezone,
      model: app.config.models[0]?.selector ?? '',
      maxDailyUsd: app.config.budget.maxDailyUsd,
      maxMonthlyUsd: app.config.budget.maxMonthlyUsd,
      channels: configuredChannels(app),
    }),
  }
}

// Configuration names the channels so every surface lists the same ones; liveness is overlaid
// only where this process runs them.
export function createHealthSummary(app: App, delivery: DeliveryHub): HealthSummaryReader {
  return {
    read: async () => ({ runtime: 'ok', channels: toChannelHealth(app, delivery) }),
  }
}

function toChannelHealth(app: App, delivery: DeliveryHub): readonly ChannelHealth[] {
  const attached = delivery.attached()
  const live = new Map(delivery.snapshots().map((snapshot) => [snapshot.channel, snapshot]))

  return configuredChannels(app).map((channel) => ({
    channel,
    code: attached ? toHealthCode(live.get(channel)) : 'unknown',
  }))
}

function configuredChannels(app: App): readonly ChannelId[] {
  return enabledChannels(app).map((definition) => definition.id)
}

// The predicate the daemon starts channels from.
export function enabledChannels(app: App): readonly ChannelDefinition[] {
  return app
    .resolve('channels')
    .filter((definition) =>
      definition.isEnabled(definition.resolveConfig(app.config.channels[definition.id]))
    )
}

export function toHealthCode(
  status: { readonly running: boolean; readonly connected: boolean } | undefined
): HealthCode {
  if (status === undefined || !status.running) {
    return 'down'
  }

  return status.connected ? 'ok' : 'degraded'
}

function boundedTotals(totals: LLMUsageTotals): LLMUsageTotals {
  return {
    inputTokens: boundedCount(totals.inputTokens),
    outputTokens: boundedCount(totals.outputTokens),
    cacheReadTokens: boundedCount(totals.cacheReadTokens),
    cacheWriteTokens: boundedCount(totals.cacheWriteTokens),
    reasoningTokens: boundedCount(totals.reasoningTokens),
    modelCalls: boundedCount(totals.modelCalls),
    costUsd: boundedUsage(totals.costUsd),
    // Carried through: this function clamps counts, and the name is neither a count nor something
    // a bound could repair. Rebuilding the totals field by field is what dropped it.
    ...(totals.modelName === undefined ? {} : { modelName: totals.modelName }),
  }
}

function boundedBreakdownRow(row: SpendBreakdownRow): SpendBreakdownRow {
  return {
    ...row,
    calls: boundedCount(row.calls),
    failedCalls: boundedCount(row.failedCalls),
    costUsd: boundedUsage(row.costUsd),
    inputTokens: boundedCount(row.inputTokens),
    cacheReadTokens: boundedCount(row.cacheReadTokens),
    cacheWriteTokens: boundedCount(row.cacheWriteTokens),
    outputTokens: boundedCount(row.outputTokens),
    reasoningTokens: boundedCount(row.reasoningTokens),
    ...(row.averageLatencyMs === undefined
      ? {}
      : { averageLatencyMs: boundedCount(row.averageLatencyMs) }),
  }
}

function boundedCalls(read: RunCalls): RunCalls {
  return {
    calls: read.calls.map(boundedAttempt),
    totalCalls: boundedCount(read.totalCalls),
    totalUsd: boundedUsage(read.totalUsd),
  }
}

function boundedAttempt(attempt: RunAttempt): RunAttempt {
  return {
    ...attempt,
    inputTokens: boundedCount(attempt.inputTokens),
    outputTokens: boundedCount(attempt.outputTokens),
    cacheReadTokens: boundedCount(attempt.cacheReadTokens),
    cacheWriteTokens: boundedCount(attempt.cacheWriteTokens),
    reasoningTokens: boundedCount(attempt.reasoningTokens),
    costUsd: boundedUsage(attempt.costUsd),
    latencyMs: boundedCount(attempt.latencyMs),
  }
}

// The store folds every attempt whose top-level run left no run row into its one row with no job.
function toJobsSpend(rows: readonly RootRunCostRow[]): JobsSpend {
  const other = rows.find((row) => row.kind === undefined || row.name === undefined)

  return {
    jobs: rows.flatMap(({ kind, name, runs, costUsd }) =>
      kind === undefined || name === undefined
        ? []
        : [{ kind, name, runs: boundedCount(runs), costUsd: boundedUsage(costUsd) }]
    ),
    otherUsd: boundedUsage(other?.costUsd ?? 0),
  }
}

function boundedUsage(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_PERSISTED_USAGE_VALUE, Math.max(0, value)) : 0
}

function boundedCount(value: number): number {
  return Math.floor(boundedUsage(value))
}
