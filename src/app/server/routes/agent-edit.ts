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
import { localeOf, parsePathId } from '@/app/server/routes/params'
import { BRAND } from '@/core/brand'
import { ConfigError, isErrno } from '@/core/errors'
import { agentId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { createPrivateFileAtomic, replacePrivateFileAtomic } from '@/core/security/private-files'
import { RESERVED_AGENT_IDS, userAgentFile } from '@/engine/api'
import { t } from '@/i18n'
import { pauseJobsOfAgent } from '@/scheduler/api'

const MAX_BODY_BYTES = 64 * 1024

type Parsed = { readonly body: AgentWriteBody } | { readonly refusal: Response }

function invalid(ctx: ApiRouteContext, detail: string): Response {
  return apiError('invalid_body', t(localeOf(ctx), 'errors.agentInvalid', { detail }))
}

async function parseWriteBody(req: Request, ctx: ApiRouteContext): Promise<Parsed> {
  const text = await req.text()

  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return { refusal: invalid(ctx, 'the body is too large') }
  }

  let raw: unknown

  try {
    raw = JSON.parse(text)
  } catch {
    return { refusal: apiError('invalid_json') }
  }

  const parsed = AGENT_WRITE_BODY.safeParse(raw)

  if (!parsed.success) {
    const issue = parsed.error.issues[0]

    return {
      refusal: invalid(ctx, `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim()),
    }
  }

  return { body: parsed.data }
}

/** The one place a body becomes a profile: the full build the daemon gives an agent at boot. A
 *  failure is the 400 the operator reads. */
function buildFrom(
  ctx: ApiRouteContext,
  id: AgentId,
  toml: string
): { readonly agent: AgentProfile } | { readonly refusal: Response } {
  try {
    return { agent: buildUserAgent(ctx.app, id, toml) }
  } catch (err: unknown) {
    return { refusal: invalid(ctx, formatErrForLog(err).message) }
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
  const agent = id === null ? undefined : ctx.app.resolve('agents').get(id)

  if (id === null || agent === undefined) {
    return Promise.resolve(apiError('not_found'))
  }

  return Promise.resolve(json(toAgentDetailWire(agent, isOwn(ctx, id)) satisfies AgentDetailWire))
}

async function handleCreate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = await parseWriteBody(req, ctx)

  if ('refusal' in parsed) {
    return parsed.refusal
  }

  const { body } = parsed
  let id: AgentId

  try {
    id = agentId(body.id ?? '')
  } catch {
    return invalid(
      ctx,
      'id must start with a lowercase letter or digit and use lowercase letters, digits, dots, dashes or underscores'
    )
  }

  if (RESERVED_AGENT_IDS.has(id) || ctx.app.resolve('agents').has(id)) {
    return idTaken(ctx, id)
  }

  const path = userAgentFile(ctx.app.config.paths.dataDir, id)

  // A file the last reload skipped still holds the id: the operator edits or removes it, not this call.
  if (await Bun.file(path).exists()) {
    return idTaken(ctx, id)
  }

  const toml = toAgentToml(body, toolNamesOf(ctx))
  const built = buildFrom(ctx, id, toml)

  if ('refusal' in built) {
    return built.refusal
  }

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

  ctx.app.resolve('bus').emit('agent_added', { agentId: id, name: built.agent.name })

  return json(toAgentDetailWire(built.agent, true) satisfies AgentDetailWire)
}

async function handleEdit(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, agentId)

  if (id === null || !ctx.app.resolve('agents').has(id)) {
    return apiError('not_found')
  }

  if (!isOwn(ctx, id)) {
    return notEditable(ctx, id)
  }

  const parsed = await parseWriteBody(req, ctx)

  if ('refusal' in parsed) {
    return parsed.refusal
  }

  if (parsed.body.id !== undefined && parsed.body.id !== id) {
    return invalid(ctx, 'id cannot change')
  }

  const path = userAgentFile(ctx.app.config.paths.dataDir, id)
  const existing = await readOwnFile(path)

  // The file went after the registry last read it: the agent is gone.
  if (existing === null) {
    return apiError('not_found')
  }

  const toml = toAgentToml(parsed.body, toolNamesOf(ctx), existing)
  const built = buildFrom(ctx, id, toml)

  if ('refusal' in built) {
    return built.refusal
  }

  await replacePrivateFileAtomic({ path, content: toml })

  const failed = await reloadRefusal(ctx)

  return failed ?? json(toAgentDetailWire(built.agent, true) satisfies AgentDetailWire)
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

async function handleDelete(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, agentId)

  if (id === null) {
    return apiError('not_found')
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
    text: t(localeOf(ctx), 'ui.agentDeleted', { id, count }),
    at: Date.now(),
  })

  return failed ?? json({ pausedSchedules: count } satisfies AgentDeletedWire)
}

async function handleReload(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  try {
    return json((await reloadUserAgents(ctx.app)) satisfies AgentsReloadWire)
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
