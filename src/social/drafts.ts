import type { SocialDraftReason, SocialDraftRow } from '@/core/types/social'
import type { RequestDecision, RequestDeps, SocialRequestInput } from '@/social/request/checks'
import type { SocialReply } from '@/social/request/outcome'
import type { KeyedSerial } from '@/social/request/serial'
import type { HttpMethod } from '@/social/types'
import { BRAND } from '@/core/brand'
import { ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { stripControls } from '@/core/utils/text'
import { MS_PER_DAY } from '@/core/utils/time'
import { notifySafely } from '@/social/notices'
import { decideRequest } from '@/social/request/checks'
import { outsideLinks } from '@/social/request/links'
import { executeRequest, refusedReply } from '@/social/request/outcome'
import { isOkStatus } from '@/social/request/send'

const VERIFICATION_HINT_RE = /verif/i
/** What the operator reads before approving: the whole body unless it is very long, never a teaser
 *  that hides a link after the first lines. */
const DRAFT_SHOWN_CHARS = 4_000

export interface SocialDraftView {
  readonly id: string
  readonly agentId: string
  readonly network: string
  readonly method: string
  readonly path: string
  readonly reason: SocialDraftReason
  /** The body as it will be sent, control characters removed, cut at `DRAFT_SHOWN_CHARS`. */
  readonly body: string
  readonly bodyCut: boolean
  readonly query?: Readonly<Record<string, string>>
  /** Every outside host the body and query name, which is often why it waits. */
  readonly links: readonly string[]
  readonly createdAt: number
  /** The skill changed since the draft was made; approval checks it against the new one. */
  readonly madeUnderOlderSkill: boolean
}

export type ApproveOutcome =
  | {
      readonly kind: 'sent'
      readonly reply: Extract<SocialReply, { kind: 'text' }>
      readonly needsVerification: boolean
    }
  | { readonly kind: 'refused'; readonly reply: Extract<SocialReply, { kind: 'refused' }> }
  /** The network answered with an error, or did not answer; the draft is kept. */
  | { readonly kind: 'failed'; readonly reply: SocialReply }

export interface DraftDeps extends RequestDeps {
  readonly serial: KeyedSerial
}

/** A draft nobody looked at for three days is no longer timely enough to post. */
const DRAFT_TTL_MS = 3 * MS_PER_DAY
/** Waiting drafts per agent and network. */
const MAX_WAITING_DRAFTS = 10

/** Drafts a stranger's post can provoke are bounded: an identical waiting one is a duplicate, and a
 *  membership holds only so many, so one agent cannot bury the operator in notices. */
export async function draftRefusal(
  deps: RequestDeps,
  decision: Extract<RequestDecision, { kind: 'draft' }>
): Promise<'duplicate' | 'drafts-full' | undefined> {
  const { input, bodyText } = decision.context
  const mine = (await deps.store.listDrafts(deps.now())).filter(
    (row) => row.agentId === input.agentId && row.network === input.network
  )

  if (
    mine.some(
      (row) =>
        row.method === input.method &&
        row.path === decision.context.path &&
        (row.body ?? '') === (bodyText ?? '')
    )
  ) {
    return 'duplicate'
  }

  return mine.length >= MAX_WAITING_DRAFTS ? 'drafts-full' : undefined
}

export async function createDraft(
  deps: RequestDeps,
  decision: Extract<RequestDecision, { kind: 'draft' }>
): Promise<string> {
  const { context, reason } = decision
  const now = deps.now()
  const id = Bun.randomUUIDv7()

  await deps.store.addDraft({
    id,
    agentId: context.input.agentId,
    network: context.input.network,
    method: context.input.method,
    path: context.path,
    ...(context.input.query === undefined ? {} : { query: context.input.query }),
    ...(context.bodyText === undefined ? {} : { body: context.bodyText }),
    reason,
    pinId: context.pinId,
    createdAt: now,
    expiresAt: now + DRAFT_TTL_MS,
  })
  await notifySafely(deps.notifier, deps.logger, {
    kind: 'draft-waiting',
    agentId: context.input.agentId,
    network: context.input.network,
    draftId: id,
    reason,
  })

  return id
}

interface NetworkHead {
  readonly current: string
  readonly apiHost: string
}

export async function listDraftViews(deps: DraftDeps): Promise<readonly SocialDraftView[]> {
  const rows = await deps.store.listDrafts(deps.now())
  const heads = new Map<string, NetworkHead | undefined>()
  const views: SocialDraftView[] = []

  for (const row of rows) {
    if (!heads.has(row.network)) {
      heads.set(row.network, await readHead(deps, row.network))
    }

    views.push(toView(row, heads.get(row.network)))
  }

  return views
}

export async function findDraftView(deps: DraftDeps, id: string): Promise<SocialDraftView> {
  const row = await readLiveDraft(deps, id)

  return toView(row, await readHead(deps, row.network))
}

async function readHead(deps: DraftDeps, network: string): Promise<NetworkHead | undefined> {
  try {
    const pointer = await deps.bundles.readPointer(network)
    const pin =
      pointer === undefined ? undefined : await deps.bundles.readPin(network, pointer.current)

    return pointer === undefined || pin === undefined || pin === 'mismatch'
      ? undefined
      : { current: pointer.current, apiHost: new URL(pin.apiBase).hostname }
  } catch (err: unknown) {
    // Without a readable pin every link counts as outside, which errs toward showing it.
    deps.logger.warn('social.draft_pin_unreadable', { network, err: formatErrForLog(err) })

    return undefined
  }
}

function toView(row: SocialDraftRow, head: NetworkHead | undefined): SocialDraftView {
  const body = stripControls(row.body ?? '')
  const query =
    row.query === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(row.query).map(([key, value]) => [
            stripControls(key),
            stripControls(value),
          ])
        )

  return {
    id: row.id,
    agentId: row.agentId,
    network: row.network,
    method: row.method,
    path: stripControls(row.path),
    reason: row.reason,
    body: body.slice(0, DRAFT_SHOWN_CHARS),
    bodyCut: body.length > DRAFT_SHOWN_CHARS,
    ...(query === undefined ? {} : { query }),
    links: outsideLinks({ body: parseBody(row.body), query }, head?.apiHost ?? ''),
    createdAt: row.createdAt,
    madeUnderOlderSkill: head !== undefined && head.current !== row.pinId,
  }
}

function parseBody(body: string | undefined): unknown {
  try {
    return body === undefined ? undefined : JSON.parse(body)
  } catch {
    return body
  }
}

function noSuchDraft(id: string): ValidationError {
  return new ValidationError(`no waiting draft ${id}`, {
    key: 'social.noSuchDraft',
    params: { id, brand: BRAND.name },
  })
}

async function readLiveDraft(deps: DraftDeps, id: string): Promise<SocialDraftRow> {
  const row = await deps.store.findDraft(id)

  if (row === undefined || row.expiresAt <= deps.now()) {
    throw noSuchDraft(id)
  }

  return row
}

function toInput(row: SocialDraftRow): SocialRequestInput {
  let body: Readonly<Record<string, unknown>> | undefined

  if (row.body !== undefined) {
    try {
      body = JSON.parse(row.body) as Record<string, unknown>
    } catch {
      throw noSuchDraft(row.id)
    }
  }

  return {
    agentId: row.agentId,
    network: row.network,
    // why-safe: written from a request whose method matched a pinned endpoint.
    method: row.method as HttpMethod,
    path: row.path,
    ...(row.query === undefined ? {} : { query: row.query }),
    ...(body === undefined ? {} : { body }),
  }
}

export async function approveDraft(
  deps: DraftDeps,
  id: string,
  signal: AbortSignal
): Promise<ApproveOutcome> {
  const { agentId, network } = await readLiveDraft(deps, id)

  // Read again once queued: an approve that waited behind another one finds the draft gone.
  return await deps.serial.run(`${agentId}:${network}`, async () =>
    approveRow(deps, await readLiveDraft(deps, id), signal)
  )
}

async function approveRow(
  deps: DraftDeps,
  row: SocialDraftRow,
  signal: AbortSignal
): Promise<ApproveOutcome> {
  // Every check runs again against the current pin, key, membership and caps; only the draft step
  // is skipped.
  const decision = await decideRequest(deps, toInput(row), { approving: true })

  if (decision.kind === 'refused') {
    return { kind: 'refused', reply: refusedReply(decision, row.network) }
  }

  if (decision.kind === 'draft') {
    throw noSuchDraft(row.id)
  }

  // Claimed first: two terminals approving one draft send it once.
  if (!(await deps.store.removeDraft(row.id))) {
    throw noSuchDraft(row.id)
  }

  let reply: SocialReply | undefined

  try {
    reply = await executeRequest(deps, decision.context, signal)
  } finally {
    // Anything but a 2xx, an abort included, puts it back: the operator can read why, fix it and
    // approve again, or discard it.
    if (!isSent(reply)) {
      await deps.store.addDraft(row)
    }
  }

  return isSent(reply)
    ? { kind: 'sent', reply, needsVerification: VERIFICATION_HINT_RE.test(reply.text) }
    : { kind: 'failed', reply }
}

function isSent(reply: SocialReply | undefined): reply is Extract<SocialReply, { kind: 'text' }> {
  return reply?.kind === 'text' && reply.status !== undefined && isOkStatus(reply.status)
}

export async function discardDraft(deps: DraftDeps, id: string): Promise<void> {
  if (!(await deps.store.removeDraft(id))) {
    throw noSuchDraft(id)
  }
}
