import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import type {
  AgentDeletedWire,
  AgentDetailWire,
  AgentsReloadWire,
  AgentWriteBody,
} from '@/app/server/wire/agents'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { AgentId } from '@/core/ids'
import type { AgentProfile } from '@/engine/api'
import '@/app/events'

import { buildUserAgent, reloadUserAgents } from '@/app/agent-registry'
import { apiError, json } from '@/app/server/http/dispatch'
import { AGENT_WRITE_BODY, toAgentDetailWire, toAgentToml } from '@/app/server/mappers/agent-edit'
import {
  fieldRefusal,
  localeOf,
  parsePathId,
  readJsonBody,
  toBodyFieldLabel,
} from '@/app/server/routes/params'
import { BRAND } from '@/core/brand'
import { ConfigError, isErrno, operatorMessageOf, ValidationError } from '@/core/errors'
import { toFieldValidationError } from '@/core/field-errors'
import { agentId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { createPrivateFileAtomic, replacePrivateFileAtomic } from '@/core/security/private-files'
import { RESERVED_AGENT_IDS, userAgentFile } from '@/engine/api'
import { type MessageKey, pluralKey, t, translateDisplayText } from '@/i18n'
import { pauseJobsOfAgent } from '@/scheduler/api'

// Each user agent holds a log sink open, so the page may not create them without bound.
const MAX_USER_AGENTS = 50

async function parseWriteBody(req: Request): Promise<AgentWriteBody> {
  const parsed = AGENT_WRITE_BODY.safeParse(await readJsonBody(req))

  if (!parsed.success) {
    throw toFieldValidationError(parsed.error, 'agent', toBodyFieldLabel)
  }

  return parsed.data
}

/** The one place a body becomes a profile: the full build the daemon gives an agent at boot. A
 *  failure is the 400 the operator reads: the build's own wording where it has one, else a line
 *  naming what the build checks. */
function buildFrom(ctx: ApiRouteContext, id: AgentId, toml: string): AgentProfile {
  try {
    return buildUserAgent(ctx.app, id, toml)
  } catch (err: unknown) {
    ctx.app.resolve('logger').debug('api.agent_build_refused', { err: formatErrForLog(err) })

    throw new ValidationError(
      formatErrForLog(err).message,
      operatorMessageOf(err) ?? { key: 'errors.agentBuildFailed' }
    )
  }
}

function toolNamesOf(ctx: ApiRouteContext): readonly string[] {
  return [...ctx.app.resolve('tools').keys()]
}

function isOwn(ctx: ApiRouteContext, id: AgentId): boolean {
  return ctx.app.resolve('userAgentIds')().has(id)
}

// A reload that cannot read the agents folder leaves the running agents as they are; the operator
// is told so, and the agents.reload_failed record carries the cause.
async function reloadRefusal(ctx: ApiRouteContext): Promise<Response | null> {
  try {
    await reloadUserAgents(ctx.app)

    return null
  } catch {
    return apiError('internal', t(localeOf(ctx), 'errors.agentReloadFailed'))
  }
}

function notEditable(ctx: ApiRouteContext, id: AgentId): Response {
  return apiError('conflict', t(localeOf(ctx), 'errors.agentNotEditable', { id }))
}

function idTaken(ctx: ApiRouteContext, id: AgentId): Response {
  return apiError('conflict', t(localeOf(ctx), 'errors.agentIdTaken', { id }))
}

function handleDetail(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, agentId)

  if (id === null) {
    return Promise.resolve(apiError('invalid_body'))
  }

  const agent = ctx.app.resolve('agents').get(id)

  return Promise.resolve(
    agent === undefined
      ? apiError('not_found')
      : json(toAgentDetailWire(agent, isOwn(ctx, id)) satisfies AgentDetailWire)
  )
}

async function handleCreate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const body = await parseWriteBody(req)
  let id: AgentId

  try {
    id = agentId(body.id ?? '')
  } catch {
    throw fieldRefusal('id', 'agent_id_shape')
  }

  if (RESERVED_AGENT_IDS.has(id) || ctx.app.resolve('agents').has(id)) {
    return idTaken(ctx, id)
  }

  if (ctx.app.resolve('userAgentIds')().size >= MAX_USER_AGENTS) {
    return apiError('conflict', t(localeOf(ctx), 'errors.agentLimit', { limit: MAX_USER_AGENTS }))
  }

  const path = userAgentFile(ctx.app.config.paths.dataDir, id)

  // A file the last reload skipped still holds the id: the operator edits or removes it, not this call.
  if (await Bun.file(path).exists()) {
    return idTaken(ctx, id)
  }

  const toml = toAgentToml(body, toolNamesOf(ctx))
  const built = buildFrom(ctx, id, toml)

  try {
    await createPrivateFileAtomic({ path, content: toml })
  } catch (err: unknown) {
    // Two creates of one id race to the same file; the loser finds it there.
    if (err instanceof ConfigError && (await Bun.file(path).exists())) {
      return idTaken(ctx, id)
    }

    throw err
  }

  const failed = await reloadRefusal(ctx)

  if (failed !== null) {
    return failed
  }

  ctx.app.resolve('bus').emit('agent_added', { agentId: id, name: built.name })

  return json(toAgentDetailWire(built, true) satisfies AgentDetailWire)
}

async function handleEdit(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, agentId)

  if (id === null) {
    return apiError('invalid_body')
  }

  if (!ctx.app.resolve('agents').has(id)) {
    return apiError('not_found')
  }

  if (!isOwn(ctx, id)) {
    return notEditable(ctx, id)
  }

  const body = await parseWriteBody(req)

  if (body.id !== undefined && body.id !== id) {
    throw fieldRefusal('id', 'id_fixed')
  }

  const path = userAgentFile(ctx.app.config.paths.dataDir, id)
  const existing = await readOwnFile(path)

  // The file went after the registry last read it: the agent is gone.
  if (existing === null) {
    return apiError('not_found')
  }

  const toml = toAgentToml(body, toolNamesOf(ctx), existing)
  const built = buildFrom(ctx, id, toml)

  await replacePrivateFileAtomic({ path, content: toml })

  const failed = await reloadRefusal(ctx)

  return failed ?? json(toAgentDetailWire(built, true) satisfies AgentDetailWire)
}

async function readOwnFile(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text()
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return null
    }

    throw err
  }
}

// Said without a pause clause when there was nothing to pause.
function deletedKey(pausedSchedules: number): MessageKey {
  return pausedSchedules === 0
    ? 'ui.agentDeleted'
    : pluralKey(pausedSchedules, 'ui.agentDeletedPausedOne', 'ui.agentDeletedPaused')
}

async function handleDelete(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, agentId)

  if (id === null) {
    return apiError('invalid_body')
  }

  const path = userAgentFile(ctx.app.config.paths.dataDir, id)
  const known = ctx.app.resolve('agents').has(id)

  if (known && !isOwn(ctx, id)) {
    return notEditable(ctx, id)
  }

  // A file the last reload skipped is not in the registry but is still the operator's to remove.
  if (!(known || (await Bun.file(path).exists()))) {
    return apiError('not_found')
  }

  if (await ctx.app.resolve('socialService').isMember(id)) {
    return apiError(
      'conflict',
      t(localeOf(ctx), 'cli.agentOnSocial', { agent: id, brand: BRAND.name })
    )
  }

  const count = await pauseJobsOfAgent(ctx.app.resolve('jobStore'), id)

  // Cleared so a later agent reusing the id is never born paused.
  await ctx.app.resolve('agentPauseStore').resume([id])
  await rm(dirname(path), { recursive: true, force: true })

  const failed = await reloadRefusal(ctx)

  // The agent is gone from disk either way, so the operator hears of it.
  ctx.app.resolve('bus').emit('daemon_notice', {
    text: t(localeOf(ctx), deletedKey(count), { id, count }),
    at: Date.now(),
  })

  return failed ?? json({ pausedSchedules: count } satisfies AgentDeletedWire)
}

async function handleReload(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  try {
    const { loaded, skipped } = await reloadUserAgents(ctx.app)
    const locale = localeOf(ctx)

    return json({
      loaded,
      skipped: skipped.map(({ id, reason }) => ({
        id,
        reason: translateDisplayText(locale, reason),
      })),
    } satisfies AgentsReloadWire)
  } catch {
    return apiError('internal', t(localeOf(ctx), 'errors.agentReloadFailed'))
  }
}

export const AGENT_EDIT_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/agents/:id', auth: true, handler: handleDetail },
  { method: 'POST', path: '/v1/agents', auth: true, handler: handleCreate },
  { method: 'PATCH', path: '/v1/agents/:id', auth: true, handler: handleEdit },
  { method: 'DELETE', path: '/v1/agents/:id', auth: true, handler: handleDelete },
  { method: 'POST', path: '/v1/agents/reload', auth: true, handler: handleReload },
]
