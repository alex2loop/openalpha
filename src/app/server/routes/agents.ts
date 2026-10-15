import type { AgentsResponse, AgentWire } from '@/app/server/wire/agents'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { AgentId } from '@/core/ids'
import type { AgentProfile } from '@/engine/api'
import type { SocialMemberView } from '@/social/api'
import type { AgentFocusRef, AgentRecordSummary } from '@/trading/api'
import { apiError, json } from '@/app/server/http/dispatch'
import { hostOf, localeOf, parsePathId } from '@/app/server/routes/params'
import { agentId } from '@/core/ids'
import { renderFocusLabel, resolveRunFocus } from '@/trading/api'

function toRecordFields(
  record: AgentRecordSummary | undefined
): Pick<AgentWire, 'record' | 'agreement' | 'contrarian' | 'overlapsWith'> {
  const { agreement } = record ?? {}

  return {
    ...(record === undefined || record.byFocus.length === 0 ? {} : { record: record.combined }),
    ...(agreement === undefined || agreement.comparedCount === 0
      ? {}
      : {
          agreement: {
            comparedCount: agreement.comparedCount,
            matchedCount: agreement.matchedCount,
          },
        }),
    ...(agreement === undefined || agreement.contrarianCount === 0
      ? {}
      : {
          contrarian: {
            count: agreement.contrarianCount,
            wins: agreement.contrarianWins,
            crowdWins: agreement.crowdWins,
          },
        }),
    overlapsWith: record?.overlapsWith ?? [],
  }
}

function toAgentWire(
  ctx: ApiRouteContext,
  agent: AgentProfile,
  extras: {
    readonly record: AgentRecordSummary | undefined
    readonly social: readonly SocialMemberView[]
    readonly paused: boolean
    readonly spentTodayUsd: number
  }
): AgentWire {
  const { paused, spentTodayUsd } = extras
  const focus = resolveRunFocus(agent.focus)

  return {
    id: agent.id,
    name: agent.name,
    paused,
    ...(agent.maxDailyUsd === undefined ? {} : { maxDailyUsd: agent.maxDailyUsd }),
    spentTodayUsd,
    focusKey: focus.key,
    focusLabel: renderFocusLabel(localeOf(ctx), focus.focus),
    ...toRecordFields(extras.record),
    social: extras.social.map((row) => ({
      network: row.network,
      state: row.state,
      reviewAll: row.reviewAll,
      drafts: row.drafts,
    })),
  }
}

function userAgentsOf(ctx: ApiRouteContext): readonly AgentProfile[] {
  const registry = ctx.app.resolve('agents')

  return [...ctx.app.resolve('userAgentIds')].sort().flatMap((id) => registry.get(id) ?? [])
}

function toFocusRef(agent: AgentProfile): AgentFocusRef {
  return { agentId: agent.id, focusKey: resolveRunFocus(agent.focus).key }
}

async function handleList(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const owned = userAgentsOf(ctx)
  const paused = await ctx.app.resolve('agentPauseStore').list()
  // One read per source for the whole listing, never one per agent.
  const records = await hostOf(ctx).listAgentRecords({
    agents: owned.map(toFocusRef),
    locale: localeOf(ctx),
    signal: req.signal,
  })
  const members = await ctx.app.resolve('socialService').listMembers()
  const spent = await ctx.app.resolve('llmAttemptStore').totalsForBillingAgents(Date.now())
  const agents = owned.map((agent) =>
    toAgentWire(ctx, agent, {
      record: records.find((row) => row.agentId === agent.id),
      social: members.filter((row) => row.agentId === agent.id),
      paused: paused.has(agent.id),
      spentTodayUsd: spent.get(agent.id) ?? 0,
    })
  )

  return json({ agents } satisfies AgentsResponse)
}

/** Only the operator's own agents: a built-in or an unknown id is `not_found`, like any absent row. */
function ownAgentOf(req: Request, ctx: ApiRouteContext): AgentId | null {
  const id = parsePathId(req, agentId, 1)

  return id !== null && ctx.app.resolve('userAgentIds').has(id) ? id : null
}

async function handlePause(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = ownAgentOf(req, ctx)

  if (id === null) {
    return apiError('not_found')
  }

  await ctx.app.resolve('agentPauseStore').pause([id], Date.now())

  return json({ ok: true })
}

async function handleResume(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = ownAgentOf(req, ctx)

  if (id === null) {
    return apiError('not_found')
  }

  await ctx.app.resolve('agentPauseStore').resume([id])

  return json({ ok: true })
}

export const AGENT_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/agents', auth: true, handler: handleList },
  { method: 'POST', path: '/v1/agents/:id/pause', auth: true, handler: handlePause },
  { method: 'POST', path: '/v1/agents/:id/resume', auth: true, handler: handleResume },
]
