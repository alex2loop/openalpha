import type { CliApp } from '@/cli/types'
import type { AgentProfile } from '@/engine/api'
import type { AgentFocusRef } from '@/trading/api'
import { formatUsd } from '@/core/utils/cost'
import { t } from '@/i18n'
import { renderFocusLabel, resolveRunFocus } from '@/trading/api'

// Every own agent is reported, not only the listed ones: overlaps are found across all of them.
function ownedFocusRefs(app: CliApp): readonly AgentFocusRef[] {
  const registry = app.resolve('agents')

  return [...app.resolve('userAgentIds')()].flatMap((id) => {
    const agent = registry.get(id)

    return agent === undefined ? [] : [{ agentId: id, focusKey: resolveRunFocus(agent.focus).key }]
  })
}

/** What `agent list` and `agent show` add under one of the operator's own agents: the focus its
 *  `[focus]` configures, today's spend against its cap, and what its calls have earned beside the
 *  other agents'. Built-in agents have none of these.
 *  The records are read once for the whole listing, never once per agent. */
export async function agentExtraLines(
  app: CliApp,
  agents: readonly AgentProfile[]
): Promise<ReadonlyMap<string, readonly string[]>> {
  const userIds = app.resolve('userAgentIds')()
  const own = agents.filter((agent) => userIds.has(agent.id))
  const lines = new Map<string, readonly string[]>()

  if (own.length === 0) {
    return lines
  }

  const locale = app.config.locale.language
  const trading = app.has('tradingHost')
  const records = trading
    ? await app.resolve('tradingHost').listAgentRecords({
        agents: ownedFocusRefs(app),
        locale,
        signal: new AbortController().signal,
      })
    : []
  const spent = await app.resolve('llmAttemptStore').totalsForBillingAgents(Date.now())

  for (const agent of own) {
    const record = records.find((row) => row.agentId === agent.id)
    const focus = renderFocusLabel(locale, resolveRunFocus(agent.focus).focus)

    lines.set(agent.id, [
      ...(trading ? [`${t(locale, 'trading.focus.label')}: ${focus}`] : []),
      ...(agent.maxDailyUsd === undefined
        ? []
        : [
            t(locale, 'cli.agentSpend', {
              spent: formatUsd(spent.get(agent.id) ?? 0),
              cap: formatUsd(agent.maxDailyUsd),
            }),
          ]),
      ...(record?.lines ?? []),
    ])
  }

  return lines
}
