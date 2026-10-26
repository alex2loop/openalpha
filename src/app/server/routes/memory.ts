import { z } from 'zod'

import type {
  MemoryForgetResult,
  MemoryResponse,
  MemoryWriteBody,
  MemoryWriteResult,
} from '@/app/server/wire/memory'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { ChannelDefinition } from '@/channels/api'
import type { AgentId } from '@/core/ids'
import type { MemoryScope, MemoryScopeEntries } from '@/memory/api'
import { configuredEntryAgent } from '@/app/chat-commands'
import { API_CHANNEL, isApiChannel } from '@/app/server/channel'
import { apiError, json } from '@/app/server/http/dispatch'
import { channelNameOf } from '@/app/server/routes/chat'
import { localeOf, readJsonBody } from '@/app/server/routes/params'
import { ValidationError } from '@/core/errors'
import { FieldValidationError } from '@/core/field-errors'
import { agentId, sessionId as brandSessionId, LOCAL_USER_ID, userId } from '@/core/ids'
import { isMemoryKey, MEMORY_KEY_MAX_LEN } from '@/core/memory-key'
import { ASKED_PREFIX, PENDING_PREFIX, PREFS_PREFIX } from '@/engine/api'
import { bindLocale, translateDisplayText } from '@/i18n'

/** The most rows one read sends; the local user's sort first, so theirs are never the ones cut. */
const MEMORY_ROUTE_MAX = 500
const PAIRED_LIST_MAX = 200
const SCOPE_SEPARATOR = '\0'
const SCOPE_KEY_RE = /^[A-Za-z0-9_-]+$/
// A proposal waiting for the operator's answer is the hook's bookkeeping, not something it knows.
const HIDDEN_PREFIXES = [PENDING_PREFIX, ASKED_PREFIX] as const
const WRITE_BODY: z.ZodType<MemoryWriteBody> = z.object({
  key: z.string(),
  value: z.string().trim().min(1),
  sessionId: z.string().min(1).exactOptional(),
})

type MemoryScopeWire = MemoryResponse['scopes'][number]

async function handleMemory(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const groups = await ctx.app
    .resolve('memory')
    .listScopes({ limit: MEMORY_ROUTE_MAX + 1, now: Date.now() })
  const truncated = groups.reduce((sum, group) => sum + group.entries.length, 0) > MEMORY_ROUTE_MAX
  const kept = truncated ? withoutLastRow(groups) : groups
  const labels = kept.some((group) => group.scope.userId !== LOCAL_USER_ID)
    ? await resolveUserLabels(ctx)
    : new Map<string, string>()

  return json({
    scopes: kept.map((group) => toScopeWire(ctx, group, labels)).filter(hasRows),
    ttlDays: ctx.app.config.memory.ttlDays,
    keyMaxLen: MEMORY_KEY_MAX_LEN,
    truncated,
  } satisfies MemoryResponse)
}

// The read asks for one row past the limit to learn there are more; that row is not sent.
function withoutLastRow(groups: readonly MemoryScopeEntries[]): readonly MemoryScopeEntries[] {
  const last = groups.at(-1)

  if (last === undefined || last.entries.length <= 1) {
    return groups.slice(0, -1)
  }

  return [...groups.slice(0, -1), { scope: last.scope, entries: last.entries.slice(0, -1) }]
}

/** Each chat user a channel names, as "{channel} {id}": its config's allowed and operator ids,
 *  then the chats paired with it. */
async function resolveUserLabels(ctx: ApiRouteContext): Promise<ReadonlyMap<string, string>> {
  const locale = localeOf(ctx)
  const pairing = ctx.app.resolve('pairingStore')
  const perChannel = await Promise.all(
    ctx.app.resolve('channels').map(async (definition) => {
      const name = translateDisplayText(locale, channelNameOf(definition.id))
      const ids = [
        ...configuredIds(definition, ctx.app.config.channels[definition.id]),
        ...(await pairing.listPaired(definition.id, PAIRED_LIST_MAX)),
      ]

      return ids.map((id): [string, string] => [id, `${name} ${id}`])
    })
  )

  // Reversed, so the first channel to name an id is the one the map keeps.
  return new Map(perChannel.flat().reverse())
}

function configuredIds(definition: ChannelDefinition, raw: unknown): readonly string[] {
  try {
    const admission = definition.admission(definition.resolveConfig(raw))

    return [...admission.allowedIds, ...admission.operatorUserIds]
  } catch {
    // A section that will not resolve names nobody; the raw id stands in for its users.
    return []
  }
}

function toScopeWire(
  ctx: ApiRouteContext,
  group: MemoryScopeEntries,
  labels: ReadonlyMap<string, string>
): MemoryScopeWire {
  const { agentId: agent, userId: user } = group.scope
  const shown = group.entries.filter(
    (entry) => !HIDDEN_PREFIXES.some((prefix) => entry.key.startsWith(prefix))
  )

  return {
    scope: toScopeKey(group.scope),
    agentId: agent,
    agentName: ctx.app.resolve('agents').get(agent)?.name ?? agent,
    userLabel: labels.get(user) ?? user,
    isLocal: user === LOCAL_USER_ID,
    told: shown
      .filter((entry) => entry.key.startsWith(PREFS_PREFIX))
      .map((entry) => ({
        key: entry.key,
        attribute: entry.key.slice(PREFS_PREFIX.length),
        value: entry.value,
        updatedAt: entry.updatedAt,
      })),
    notes: shown.filter((entry) => !entry.key.startsWith(PREFS_PREFIX)),
  }
}

function hasRows(scope: MemoryScopeWire): boolean {
  return scope.told.length > 0 || scope.notes.length > 0
}

/** Writes a note for the web chat's scope: the open chat's agent, else the app's entry agent, and
 *  the local user. Refused keys and values carry the sentences `/memory remember` answers with. */
async function handleMemoryWrite(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = WRITE_BODY.safeParse(await readJsonBody(req))

  if (!parsed.success) {
    return apiError('invalid_body')
  }

  const { key, value, sessionId } = parsed.data

  if (!isMemoryKey(key)) {
    throw new FieldValidationError('invalid memory key', [
      {
        path: 'key',
        message: { key: 'slash.memoryKeyInvalid', params: { max: MEMORY_KEY_MAX_LEN } },
      },
    ])
  }

  const agent = await resolveWebAgent(ctx, sessionId)

  if (agent instanceof Response) {
    return agent
  }

  await storeNote({ agentId: agent, userId: LOCAL_USER_ID }, { ctx, key, value })

  return json({ key } satisfies MemoryWriteResult)
}

/** The agent the web chat `raw` names talks to; a refusal for an unknown or another channel's chat. */
async function resolveWebAgent(
  ctx: ApiRouteContext,
  raw: string | undefined
): Promise<AgentId | Response> {
  if (raw === undefined) {
    return configuredEntryAgent(ctx.app, API_CHANNEL)
  }

  const id = parseSessionId(raw)
  const channel = id === undefined ? undefined : await ctx.app.resolve('sessionStore').channelOf(id)

  if (id === undefined || channel === undefined) {
    return apiError('not_found')
  }

  if (!isApiChannel(channel)) {
    return apiError(
      'conflict',
      bindLocale(localeOf(ctx)).translate('errors.chatSessionNotWeb', {
        channel: channelNameOf(channel),
      })
    )
  }

  // For the app's chat the chat id is the session id; a binding to a deleted agent is passed over.
  const binding = await ctx.app.resolve('chatBindingStore').get(API_CHANNEL, id)

  return binding !== null && ctx.app.resolve('agents').has(binding.agentId)
    ? binding.agentId
    : configuredEntryAgent(ctx.app, API_CHANNEL)
}

function parseSessionId(raw: string): ReturnType<typeof brandSessionId> | undefined {
  try {
    return brandSessionId(raw)
  } catch {
    return undefined
  }
}

async function storeNote(
  scope: MemoryScope,
  note: { readonly ctx: ApiRouteContext; readonly key: string; readonly value: string }
): Promise<void> {
  try {
    await note.ctx.app.resolve('memory').store(scope, note.key, { value: note.value })
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      throw new FieldValidationError('memory value refused', [
        { path: 'value', message: { key: 'slash.memoryRejected' } },
      ])
    }

    throw err
  }
}

/** Forgets one key in one scope. A told preference takes its open question with it. */
async function handleMemoryForget(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const params = new URL(req.url).searchParams
  const scope = parseScopeKey(params.get('scope'))
  const key = params.get('key')

  if (scope === undefined || key === null || !isMemoryKey(key)) {
    return apiError('invalid_body')
  }

  const memory = ctx.app.resolve('memory')
  const removed = await memory.remove(scope, key)

  if (removed > 0 && key.startsWith(PREFS_PREFIX)) {
    const attribute = key.slice(PREFS_PREFIX.length)

    await Promise.all(
      HIDDEN_PREFIXES.map((prefix) => memory.remove(scope, `${prefix}${attribute}`))
    )
  }

  return json({ removed } satisfies MemoryForgetResult)
}

/** A scope's stable key: its agent and user, base64url-encoded with a NUL between. */
function toScopeKey(scope: MemoryScope): string {
  return Buffer.from(`${scope.agentId}${SCOPE_SEPARATOR}${scope.userId}`).toString('base64url')
}

// Undefined for a key no scope could have made, so a malformed one is told apart from a gone one.
function parseScopeKey(raw: string | null): MemoryScope | undefined {
  if (raw === null || !SCOPE_KEY_RE.test(raw)) {
    return undefined
  }

  const parts = Buffer.from(raw, 'base64url').toString('utf8').split(SCOPE_SEPARATOR)
  const [agent = '', user = ''] = parts

  if (parts.length !== 2 || agent === '' || user === '') {
    return undefined
  }

  try {
    const scope = { agentId: agentId(agent), userId: userId(user) }

    return toScopeKey(scope) === raw ? scope : undefined
  } catch {
    return undefined
  }
}

export const MEMORY_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/memory', auth: true, handler: handleMemory },
  { method: 'POST', path: '/v1/memory', auth: true, handler: handleMemoryWrite },
  { method: 'DELETE', path: '/v1/memory', auth: true, handler: handleMemoryForget },
]
