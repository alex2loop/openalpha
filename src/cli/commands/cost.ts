import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import type { CostRange, SpendBreakdownRow } from '@/core/types/usage'
import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { flagBool } from '@/cli/parsing/args'
import { style } from '@/cli/ui/colors'
import { formatSpend, formatTokenCount, formatUsd, sentTokensOf } from '@/core/utils/cost'
import { formatDuration } from '@/core/utils/duration'
import { dayInZone, daysSinceMonday, MS_PER_DAY, parseIsoDay, utcDay } from '@/core/utils/time'
import { pluralKey, t } from '@/i18n'

const PERIODS = ['day', 'week', 'month'] as const
const MAX_RANGE_DAYS = 366
const SEGMENT_SEPARATOR = ' · '

type CostPeriod = (typeof PERIODS)[number]

interface RangeSelection {
  readonly range: CostRange
  readonly period?: CostPeriod
}

type RangeResult =
  | { readonly kind: 'value'; readonly selection: RangeSelection }
  | { readonly kind: 'error'; readonly error: string }

export const costCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.cost,
  spec: {
    flags: {
      period: {
        type: 'string',
        choices: PERIODS,
        describe: { key: 'cliHelp.flagCostPeriod' },
      },
      from: { type: 'string', describe: { key: 'cliHelp.flagCostFrom' } },
      to: { type: 'string', describe: { key: 'cliHelp.flagCostTo' } },
      breakdown: { type: 'boolean', describe: { key: 'cliHelp.flagCostBreakdown' } },
    },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const nowMs = Date.now()
    // The operator's own day: the range is read on the calendar the caps reset on.
    const today = dayInZone(nowMs, app.config.locale.timezone)
    const resolved = resolveRange(args, today, locale)

    if (resolved.kind === 'error') {
      return usage(app, resolved.error)
    }

    const { range, period } = resolved.selection
    const spend = app.resolve('spendReader')
    const total =
      period === 'day' ? await spend.forPeriod('day', nowMs) : await spend.forRange(range)

    app.out(style.heading(t(locale, 'cli.costHeading')))
    app.out(t(locale, 'cli.costRangeLine', { from: range.fromDay, to: range.toDay }))
    app.out(t(locale, 'cli.costTotalLine', { cost: formatCost(total, period, app.config.budget) }))

    if (flagBool(args, 'breakdown')) {
      const rows =
        period === 'day'
          ? await spend.breakdownForPeriod('day', nowMs)
          : await spend.breakdownForRange(range)

      printBreakdown(app, { rows, period })
    }

    return 0
  },
})

function resolveRange(
  args: Readonly<Record<string, unknown>>,
  today: string,
  locale: Locale
): RangeResult {
  const rawPeriod = args.period
  const rawFrom = args.from
  const rawTo = args.to
  const hasPeriod = typeof rawPeriod === 'string'
  const hasFrom = typeof rawFrom === 'string'
  const hasTo = typeof rawTo === 'string'

  if (hasPeriod && (hasFrom || hasTo)) {
    return { kind: 'error', error: t(locale, 'cli.costPeriodConflict') }
  }

  if (hasFrom !== hasTo) {
    return { kind: 'error', error: t(locale, 'cli.costFromToTogether') }
  }

  if (hasFrom && hasTo) {
    return resolveCustomRange(rawFrom, rawTo, locale)
  }

  return resolvePeriodRange(rawPeriod, today, locale)
}

function resolveCustomRange(fromDay: string, toDay: string, locale: Locale): RangeResult {
  const fromMs = parseIsoDay(fromDay)
  const toMs = parseIsoDay(toDay)

  if (fromMs === undefined) {
    return { kind: 'error', error: t(locale, 'cli.costInvalidFromDay', { day: fromDay }) }
  }

  if (toMs === undefined) {
    return { kind: 'error', error: t(locale, 'cli.costInvalidToDay', { day: toDay }) }
  }

  if (fromMs > toMs) {
    return { kind: 'error', error: t(locale, 'cli.costFromBeforeTo') }
  }

  const days = (toMs - fromMs) / MS_PER_DAY + 1

  if (days > MAX_RANGE_DAYS) {
    return { kind: 'error', error: t(locale, 'cli.costRangeExceeded', { max: MAX_RANGE_DAYS }) }
  }

  return { kind: 'value', selection: { range: { fromDay, toDay } } }
}

function resolvePeriodRange(rawPeriod: unknown, today: string, locale: Locale): RangeResult {
  const period = resolvePeriod(rawPeriod)
  const todayMs = parseIsoDay(today)

  if (period === undefined || todayMs === undefined) {
    return { kind: 'error', error: t(locale, 'cli.costInvalidPeriod') }
  }

  if (period === 'day') {
    return { kind: 'value', selection: { range: { fromDay: today, toDay: today }, period } }
  }

  const fromDay =
    period === 'week'
      ? utcDay(todayMs - daysSinceMonday(today) * MS_PER_DAY)
      : `${today.slice(0, 8)}01`

  return { kind: 'value', selection: { range: { fromDay, toDay: today }, period } }
}

function resolvePeriod(value: unknown): CostPeriod | undefined {
  if (value === undefined) {
    return 'day'
  }

  if (value === 'day' || value === 'week' || value === 'month') {
    return value
  }

  return undefined
}

function formatCost(
  total: number,
  period: CostPeriod | undefined,
  budget: { readonly maxDailyUsd: number; readonly maxMonthlyUsd: number }
): string {
  if (period === 'day') {
    return formatSpend(total, budget.maxDailyUsd)
  }

  if (period === 'month') {
    return formatSpend(total, budget.maxMonthlyUsd)
  }

  return formatUsd(total)
}

interface BreakdownInput {
  readonly rows: readonly SpendBreakdownRow[]
  readonly period: CostPeriod | undefined
}

/** One line per agent whose cap the spend counted against, before the per-model rows. */
function printAgentTotals(app: CliApp, input: BreakdownInput): void {
  const locale = app.config.locale.language
  const totals = new Map<string, number>()

  for (const row of input.rows) {
    totals.set(row.billingAgentId, (totals.get(row.billingAgentId) ?? 0) + row.costUsd)
  }

  app.out(t(locale, 'cli.costByAgent'))

  for (const [agent, spent] of totals) {
    // A cap beside a week's spend would mislead, so only today's total is set against it.
    const cap = input.period === 'day' ? app.resolve('agents').get(agent)?.maxDailyUsd : undefined

    app.out(
      cap === undefined
        ? t(locale, 'cli.costAgentLine', { agent, spent: formatUsd(spent) })
        : t(locale, 'cli.costAgentCapped', {
            agent,
            spent: formatUsd(spent),
            cap: formatUsd(cap),
          })
    )
  }
}

function printBreakdown(app: CliApp, input: BreakdownInput): void {
  const locale = app.config.locale.language
  const { rows } = input

  if (rows.length === 0) {
    app.out(t(locale, 'cli.costBreakdownEmpty'))
    return
  }

  printAgentTotals(app, input)
  app.out(t(locale, 'cli.costBreakdownHeading'))

  for (const row of rows) {
    printBreakdownRow(app, locale, row)
  }
}

function printBreakdownRow(app: CliApp, locale: Locale, row: SpendBreakdownRow): void {
  const model = `${row.provider}/${row.model}`
  const spent = spendSegments(locale, row).join(SEGMENT_SEPARATOR)

  app.out(t(locale, 'cli.costBreakdownSubject', { agent: row.agentId, model }))
  app.out(t(locale, 'cli.costBreakdownLine', { line: spent }))

  if (sentTokensOf(row) + row.outputTokens > 0) {
    const tokens = tokenSegments(locale, row).join(SEGMENT_SEPARATOR)

    app.out(t(locale, 'cli.costBreakdownLine', { line: tokens }))
  }
}

function spendSegments(locale: Locale, row: SpendBreakdownRow): readonly string[] {
  const callsKey = pluralKey(row.calls, 'cli.costBreakdownCallsOne', 'cli.costBreakdownCalls')
  const latency =
    row.averageLatencyMs === undefined ? undefined : formatDuration(locale, row.averageLatencyMs)

  return [
    formatUsd(row.costUsd),
    t(locale, callsKey, { calls: row.calls }),
    ...(row.failedCalls === 0
      ? []
      : [t(locale, 'cli.costBreakdownFailed', { failed: row.failedCalls })]),
    ...(latency === undefined ? [] : [t(locale, 'cli.costBreakdownLatency', { latency })]),
  ]
}

// Worded like the run footer, so "tokens sent" means the same number on every surface.
function tokenSegments(locale: Locale, row: SpendBreakdownRow): readonly string[] {
  const input = formatTokenCount(sentTokensOf(row))
  const output = formatTokenCount(row.outputTokens)
  const sent =
    row.cacheReadTokens === 0
      ? t(locale, 'footer.tokens', { input, output })
      : t(locale, 'footer.tokensCached', {
          input,
          output,
          cached: formatTokenCount(row.cacheReadTokens),
        })

  return [
    sent,
    ...(row.reasoningTokens === 0
      ? []
      : [
          t(locale, 'cli.costBreakdownThinking', {
            reasoning: formatTokenCount(row.reasoningTokens),
          }),
        ]),
  ]
}
