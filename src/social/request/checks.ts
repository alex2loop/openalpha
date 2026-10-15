import { createHash } from 'node:crypto'

import type { AgentId } from '@/core/ids'
import type { SocialDraftReason, SocialMembershipRow } from '@/core/types/social'
import type { MembershipDeps } from '@/social/membership'
import type { SocialNotifier } from '@/social/notices'
import type { ReadLimiter } from '@/social/request/rate'
import type { SocialLabel } from '@/social/skill/labels'
import type { HttpMethod, NetworkPin, SocialEndpoint } from '@/social/types'
import { hasLikelySecret } from '@/core/security/credentials'
import { dayBoundsInZone, MS_PER_DAY, MS_PER_SECOND } from '@/core/utils/time'
import { isCappedLabel } from '@/social/config'
import { notifySafely } from '@/social/notices'
import { apiBasePath } from '@/social/pin/api-base'
import { outsideLinks } from '@/social/request/links'
import { isUnderApiBase, matchEndpoint } from '@/social/request/path'
import { LABEL_POLICY } from '@/social/skill/labels'
import { socialToolSet, toolsOutsideRules } from '@/social/tool-rules'

export type RequestRefusal =
  | 'agent-unavailable'
  | 'tools-changed'
  | 'not-member'
  | 'network-paused'
  | 'member-paused'
  | 'pin-mismatch'
  | 'no-key'
  | 'bad-path'
  | 'method-override'
  | 'unknown-endpoint'
  | 'blocked'
  | 'unlabelled'
  | 'no-focus'
  | 'secret'
  | 'own-key'
  | 'cooldown'
  | 'daily-cap'
  | 'read-rate'
  | 'duplicate'
  | 'drafts-full'

type RefusalParams = Readonly<Record<string, string | number>>

export interface SocialRequestInput {
  readonly agentId: AgentId
  readonly network: string
  readonly method: HttpMethod
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, unknown>>
}

/** What a request resolved to, with everything a send needs, so nothing is read twice. */
export interface RequestContext {
  readonly input: SocialRequestInput
  readonly pinId: string
  readonly pin: NetworkPin
  /** The request path relative to the API base, after the base prefix was stripped. */
  readonly path: string
  readonly endpoint: SocialEndpoint
  readonly label: SocialLabel
  readonly membership: SocialMembershipRow
  readonly apiKey: string
  readonly bodyText?: string
  readonly bodyHash?: string
}

interface Refused {
  readonly kind: 'refused'
  readonly refusal: RequestRefusal
  readonly params?: RefusalParams
}

export type RequestDecision =
  | Refused
  | { readonly kind: 'draft'; readonly reason: SocialDraftReason; readonly context: RequestContext }
  | { readonly kind: 'send'; readonly context: RequestContext }

export interface RequestDeps extends MembershipDeps {
  readonly reads: ReadLimiter
  readonly notifier: SocialNotifier
  /** `[locale] timezone`: a daily cap counts the operator's day. */
  readonly timeZone: string
}

/** A member in good standing, with the pin it is held to and the key to send with. */
interface Member {
  readonly pinId: string
  readonly pin: NetworkPin
  readonly membership: SocialMembershipRow
  readonly apiKey: string
}

interface SecretFree {
  readonly bodyText?: string
}

const DUPLICATE_WINDOW_MS = MS_PER_DAY
/** Frameworks that read `_method` or an override field send what it names, not the pinned method. */
const METHOD_OVERRIDE_KEY_RE = /^(?:_method|(?:x[-_])?(?:http[-_])?method[-_]override)$/i

export function isRefused(value: unknown): value is Refused {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'refused'
}

function refuse(refusal: RequestRefusal, params?: RefusalParams): Refused {
  return { kind: 'refused', refusal, ...(params === undefined ? {} : { params }) }
}

/** The network's pinned files no longer match what the operator approved: nothing reads or sends
 *  until the operator looks. One notice per change. */
export async function pausePinMismatch(
  deps: Pick<RequestDeps, 'store' | 'notifier' | 'logger' | 'now'>,
  network: string
): Promise<void> {
  const changed = await deps.store.setNetworkState(network, 'paused', {
    reason: 'pin-mismatch',
    at: deps.now(),
  })

  if (changed) {
    await notifySafely(deps.notifier, deps.logger, { kind: 'pin-mismatch', network })
  }
}

export async function decideRequest(
  deps: RequestDeps,
  input: SocialRequestInput,
  options: { readonly approving: boolean }
): Promise<RequestDecision> {
  const now = deps.now()
  const member = await membershipStep(deps, input)

  if (isRefused(member)) {
    return member
  }

  const routed = pathStep(member.pin, input)

  if (isRefused(routed)) {
    return routed
  }

  if (hasMethodOverride(input)) {
    return refuse('method-override')
  }

  const secrets = secretStep(input, member.apiKey)

  if (isRefused(secrets)) {
    return secrets
  }

  const context: RequestContext = {
    input,
    pinId: member.pinId,
    pin: member.pin,
    path: routed.path,
    endpoint: routed.endpoint,
    label: routed.label,
    membership: member.membership,
    apiKey: member.apiKey,
    ...(secrets.bodyText === undefined
      ? {}
      : {
          bodyText: secrets.bodyText,
          bodyHash: writeHash(input, { path: routed.path, bodyText: secrets.bodyText }),
        }),
  }
  const drafted = options.approving ? undefined : draftStep(context)

  if (drafted !== undefined) {
    return { kind: 'draft', reason: drafted, context }
  }

  const limited = await rateStep(deps, context, now)

  return limited ?? { kind: 'send', context }
}

async function agentStep(deps: RequestDeps, id: AgentId): Promise<Refused | undefined> {
  const agent = deps.agents.get(id)

  if (agent === undefined || (await deps.agents.isPaused(id))) {
    return refuse('agent-unavailable')
  }

  // An agent whose `[focus]` was removed after it joined would otherwise publish the book's own
  // call, sizes included.
  if (!deps.agents.hasOwnFocus(id)) {
    return refuse('no-focus')
  }

  const outside = toolsOutsideRules(
    agent.tools,
    socialToolSet(deps.config.allowedTools, deps.tools())
  )

  return outside.length > 0 ? refuse('tools-changed', { tools: outside.join(', ') }) : undefined
}

/** The agent, the network and the membership are all in good standing. Also what `social_skill`
 *  checks before it reads anything. */
export async function membershipStep(
  deps: RequestDeps,
  input: Pick<SocialRequestInput, 'agentId' | 'network'>
): Promise<Refused | Member> {
  const agentRefusal = await agentStep(deps, input.agentId)

  if (agentRefusal !== undefined) {
    return agentRefusal
  }

  const network = await deps.store.findNetwork(input.network)

  if (network === undefined) {
    return refuse('not-member')
  }

  if (network.state !== 'active') {
    return refuse('network-paused')
  }

  const membership = await deps.store.findMembership(input.agentId, input.network)

  if (membership === undefined || membership.state === 'refused') {
    return refuse('not-member')
  }

  if (membership.state !== 'active') {
    return refuse('member-paused')
  }

  return await pinStep(deps, { agentId: input.agentId, network: input.network, membership })
}

async function pinStep(
  deps: RequestDeps,
  who: {
    readonly agentId: AgentId
    readonly network: string
    readonly membership: SocialMembershipRow
  }
): Promise<Refused | Member> {
  const pointer = await deps.bundles.readPointer(who.network)
  const pin =
    pointer === undefined ? undefined : await deps.bundles.readPin(who.network, pointer.current)

  if (pointer === undefined || pin === undefined) {
    return refuse('pin-mismatch')
  }

  if (pin === 'mismatch') {
    await pausePinMismatch(deps, who.network)

    return refuse('pin-mismatch')
  }

  const apiKey = await deps.keys.read(who.network, who.agentId)

  return apiKey === undefined
    ? refuse('no-key')
    : { pinId: pointer.current, pin, membership: who.membership, apiKey }
}

interface Routed {
  readonly path: string
  readonly endpoint: SocialEndpoint
  readonly label: SocialLabel
}

function pathStep(pin: NetworkPin, input: SocialRequestInput): Refused | Routed {
  const base = apiBasePath(pin.apiBase)
  // The network's own answers write `/api/v1/verify`; the base is stripped so the URL is never
  // `/api/v1/api/v1/...`.
  const path =
    base !== '' && input.path.startsWith(`${base}/`) ? input.path.slice(base.length) : input.path
  const match = matchEndpoint(pin, input.method, path)

  // Every path refusal names what the model may call instead, so it can correct itself.
  if (match.kind === 'refused' || !isUnderApiBase(pin.apiBase, path)) {
    return refuse('bad-path', { endpoints: listedEndpoints(pin) })
  }

  if (match.kind === 'unknown') {
    return refuse('unknown-endpoint', { endpoints: listedEndpoints(pin) })
  }

  const { label } = match.endpoint

  if (label === undefined) {
    return refuse('unlabelled', { endpoints: listedEndpoints(pin) })
  }

  return LABEL_POLICY[label] === 'blocked'
    ? refuse('blocked', { label, endpoints: listedEndpoints(pin) })
    : { path, endpoint: match.endpoint, label }
}

function listedEndpoints(pin: NetworkPin): string {
  return pin.endpoints
    .filter(
      (endpoint) => endpoint.label !== undefined && LABEL_POLICY[endpoint.label] !== 'blocked'
    )
    .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    .join('\n')
}

function secretStep(input: SocialRequestInput, apiKey: string): Refused | SecretFree {
  const bodyText = input.body === undefined ? undefined : JSON.stringify(input.body)
  const texts = [
    input.path,
    ...(bodyText === undefined ? [] : [bodyText]),
    ...Object.entries(input.query ?? {}).flat(),
  ]

  if (texts.some((text) => text.includes(apiKey))) {
    return refuse('own-key')
  }

  if (texts.some((text) => hasLikelySecret(text))) {
    return refuse('secret')
  }

  return bodyText === undefined ? {} : { bodyText }
}

/** The same text on another endpoint (an upvote body on a second post) is a different write; the
 *  path is the one routed under the API base, so `/api/v1/posts` and `/posts` are one endpoint. */
function writeHash(
  input: SocialRequestInput,
  routed: { readonly path: string; readonly bodyText: string }
): string {
  const query = JSON.stringify(input.query ?? {})

  return createHash('sha256')
    .update(`${input.method} ${routed.path} ${query}\n${routed.bodyText}`)
    .digest('hex')
}

function hasMethodOverride(input: SocialRequestInput): boolean {
  const keys = [...Object.keys(input.query ?? {}), ...Object.keys(input.body ?? {})]

  return keys.some((key) => METHOD_OVERRIDE_KEY_RE.test(key))
}

function draftStep(context: RequestContext): SocialDraftReason | undefined {
  const policy = LABEL_POLICY[context.label]

  if (policy === 'draft') {
    return context.label === 'dm' ? 'dm' : 'delete'
  }

  if (policy !== 'public-write') {
    return undefined
  }

  const links = outsideLinks(
    { body: context.input.body, query: context.input.query },
    new URL(context.pin.apiBase).hostname
  )

  if (links.length > 0) {
    return 'outside-link'
  }

  return context.membership.reviewAll ? 'review-all' : undefined
}

async function rateStep(
  deps: RequestDeps,
  context: RequestContext,
  now: number
): Promise<Refused | undefined> {
  const { label, input, membership } = context
  const key = `${input.agentId}:${input.network}`

  if (label !== 'read' && label !== 'verify' && (membership.cooldownUntil ?? 0) > now) {
    const seconds = Math.ceil(((membership.cooldownUntil ?? now) - now) / MS_PER_SECOND)

    return refuse('cooldown', { network: input.network, seconds })
  }

  if (label === 'read') {
    return deps.reads.take(key, now) ? undefined : refuse('read-rate')
  }

  return await writeLimits(deps, context, now)
}

async function writeLimits(
  deps: RequestDeps,
  context: RequestContext,
  now: number
): Promise<Refused | undefined> {
  const { label, input, bodyHash } = context
  const scope = { agentId: input.agentId, network: input.network }

  if (isCappedLabel(label)) {
    const cap = deps.config.dailyCaps[label]
    const since = dayBoundsInZone(now, deps.timeZone).fromMs

    if ((await deps.store.countWrites({ ...scope, label, since })) >= cap) {
      return refuse('daily-cap', { label, cap, network: input.network })
    }
  }

  // A verification answer may repeat; it is the network asking, not the agent posting again.
  if (bodyHash !== undefined && label !== 'verify') {
    const since = now - DUPLICATE_WINDOW_MS

    if (await deps.store.hasWrite({ ...scope, bodyHash, since })) {
      return refuse('duplicate')
    }
  }

  return undefined
}
