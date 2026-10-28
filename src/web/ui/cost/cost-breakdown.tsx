import type { CostReport } from '@/app/server/wire/system'
import { pluralKey } from '@/i18n'
import { formatUsdCents } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { formatAgentName, formatRunName } from '@/web/text/run-name'
import { tr } from '@/web/text/tr'
import { Fold } from '@/web/ui/kit/fold'

type CostRow = CostReport['rows'][number]

/** Rows of one report summed under one key; `row` is the first, for the names. */
interface CostGroup {
  readonly key: string
  readonly row: CostRow
  readonly costUsd: number
  readonly calls: number
  readonly failedCalls: number
}

/** Where a period's spend went: by job (with "Khác" for calls no run holds), by agent, by model. */
export function CostBreakdown({ report }: { readonly report: CostReport }) {
  return (
    <div>
      <Fold title={tr('ui.office.cost.jobs')}>
        <JobRows report={report} />
      </Fold>
      <Fold title={tr('ui.office.cost.byAgent')}>
        {groupRows(report.rows, (row) => row.billingAgentId).map((group) => (
          <BreakdownRow
            key={group.key}
            name={formatAgentName(group.row.billingAgentId)}
            facts={[describeCalls(group.calls)]}
            costUsd={group.costUsd}
          />
        ))}
      </Fold>
      <Fold title={tr('ui.office.cost.byModel')}>
        {groupRows(report.rows, (row) => JSON.stringify([row.provider, row.model])).map((group) => (
          <BreakdownRow
            key={group.key}
            name={group.row.model}
            facts={[group.row.provider, ...describeModelCalls(group)]}
            costUsd={group.costUsd}
          />
        ))}
      </Fold>
    </div>
  )
}

function JobRows({ report }: { readonly report: CostReport }) {
  return (
    <>
      {report.jobs.map((job) => (
        <BreakdownRow
          key={`${job.kind}:${job.name}`}
          name={formatRunName(job)}
          facts={[
            tr(pluralKey(job.runs, 'ui.office.cost.runsOne', 'ui.office.cost.runs'), {
              count: job.runs,
            }),
          ]}
          costUsd={job.costUsd}
        />
      ))}
      {report.otherUsd > 0 && (
        <BreakdownRow name={tr('ui.office.cost.other')} facts={[]} costUsd={report.otherUsd} />
      )}
    </>
  )
}

function BreakdownRow({
  name,
  facts,
  costUsd,
}: {
  readonly name: string
  readonly facts: readonly string[]
  readonly costUsd: number
}) {
  return (
    <div class="cost-row">
      <div class="cost-row-main">
        <b>{name}</b>
        {facts.length > 0 && <p class="meta">{joinInline(facts)}</p>}
      </div>
      <span class="cost-row-figure">
        {tr('ui.office.cost.amount', { usd: formatUsdCents(costUsd) })}
      </span>
    </div>
  )
}

// Costliest first, as the daemon orders its own rows.
function groupRows(
  rows: readonly CostRow[],
  keyOf: (row: CostRow) => string
): readonly CostGroup[] {
  const groups = new Map<string, CostGroup>()

  for (const row of rows) {
    const key = keyOf(row)
    const held = groups.get(key)

    groups.set(key, {
      key,
      row: held?.row ?? row,
      costUsd: (held?.costUsd ?? 0) + row.costUsd,
      calls: (held?.calls ?? 0) + row.calls,
      failedCalls: (held?.failedCalls ?? 0) + row.failedCalls,
    })
  }

  return [...groups.values()].sort((a, b) => b.costUsd - a.costUsd)
}

function describeModelCalls(group: CostGroup): readonly string[] {
  return [
    describeCalls(group.calls),
    ...(group.failedCalls === 0 ? [] : [tr('ui.office.cost.failed', { count: group.failedCalls })]),
  ]
}

function describeCalls(count: number): string {
  return tr(pluralKey(count, 'ui.office.cost.callsOne', 'ui.office.cost.calls'), { count })
}
