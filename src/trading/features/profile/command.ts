import type {
  CommandMessage,
  CommandMessageKey,
  CommandMessageValues,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { ProfileSetField } from '@/trading/features/profile/patch'
import type {
  ProfileService,
  SegmentPolicyRequest,
  SegmentRequest,
} from '@/trading/features/profile/types'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import { closestName } from '@/core/utils/text'
import {
  assertOffered,
  offeredFields,
  parseProfilePatch,
  parseSegmentPolicyRequest,
  profileFieldValues,
  toFieldShape,
} from '@/trading/features/profile/patch'
import { renderProfileText } from '@/trading/features/profile/render'
import { SEGMENT_POLICY_FIELDS, SEGMENT_TOGGLES } from '@/trading/features/profile/types'
import {
  disabledSegments,
  INVESTMENT_GOALS,
  INVESTMENT_HORIZONS,
} from '@/trading/kernel/operator/profile'
import { parseMember, usage } from '@/trading/kernel/surface/surface'
import { answerSurfaceOf, resolveRenderContext } from '@/trading/render/format'
import { INLINE_SEPARATOR } from '@/trading/render/layout'

const USAGE: 'slash.tradingProfileUsage' = 'slash.tradingProfileUsage'
const REFUSAL_KEYS = Object.freeze([
  'slash.tradingProfileFieldUnknown',
  'slash.tradingProfileFieldNear',
  'slash.tradingProfileSetChoice',
  'slash.tradingProfileSetShare',
  'slash.tradingProfileSetSegment',
] as const)
const EXAMPLE_SHARE = '20%'
const SEGMENT_PLACEHOLDER = '<segment>'
const GOAL_OPTIONS = INVESTMENT_GOALS.join('|')
const SHOW_ACTION = 'show'
const SET_ACTION = 'set'
const RESET_ACTION = 'reset'
const ACTIONS: readonly string[] = Object.freeze([
  SHOW_ACTION,
  SET_ACTION,
  RESET_ACTION,
  ...SEGMENT_TOGGLES,
])

type Profiles = Pick<
  ProfileService,
  | 'get'
  | 'update'
  | 'reset'
  | 'segments'
  | 'heldSegments'
  | 'homeSegment'
  | 'updateSegment'
  | 'updateSegmentPolicy'
>

/** Where an edition offers fewer settings than the installed version: the ones it prints and
 *  accepts, and the usage text it answers with. */
export interface ProfileEdition {
  readonly fields: ReadonlySet<ProfileSetField>
  readonly usage: CommandMessageKey
}

interface ProfileCommandDeps {
  readonly profiles: Profiles
  readonly timezone: string
  /** Absent offers every setting under the installed version's words. */
  readonly edition?: ProfileEdition | undefined
}

export function createProfileCommand(deps: ProfileCommandDeps): SlashCommand {
  const { edition } = deps

  return {
    name: 'profile',
    description: { kind: 'localized', key: 'slash.tradingProfileHelp' },
    messageKeys: [edition?.usage ?? USAGE, ...REFUSAL_KEYS],
    policy: { surfaces: ['channel', 'repl'], role: 'operator', action: 'mutate' },
    completeFor: (args) => completeProfile(deps, args),
    usage: () => ({ key: usageKeyOf(deps), values: buildUsageValues(deps.profiles) }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: ProfileCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  // Every word the grammar reads is lower case, values included, so case never decides a parse.
  const [action, ...rest] = ctx.args.map((arg) => arg.toLowerCase())

  if (action === undefined || action === SHOW_ACTION) {
    return rest.length === 0 ? runShow(deps, ctx) : usageFor(deps)
  }

  if (action === SET_ACTION) {
    return runSet(deps, ctx, rest)
  }

  if (action === RESET_ACTION) {
    return runReset(deps, ctx, rest)
  }

  const kind = parseMember(action, SEGMENT_TOGGLES)

  if (kind === null) {
    return usageFor(deps)
  }

  const segment = rest.length === 1 ? parseMember(rest[0], deps.profiles.segments()) : null

  return segment === null ? usageFor(deps) : runSegment(deps, ctx, { kind, segment })
}

async function runShow(deps: ProfileCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const profile = await deps.profiles.get({
    signal: ctx.signal,
  })

  return shown(deps, ctx, profile)
}

async function runSet(
  deps: ProfileCommandDeps,
  ctx: SlashContext,
  rest: readonly string[]
): Promise<SlashResult> {
  const [field, ...values] = rest

  if (field === undefined) {
    return usageFor(deps)
  }

  assertOffered(fieldsOf(deps), [field])

  const segments = deps.profiles.segments()
  const policy = parseSegmentPolicyRequest({ field, values, segments })

  if (policy !== null) {
    return runPolicy(deps, ctx, policy)
  }

  const patch = parseProfilePatch({ field, values, segments })

  if (patch === null) {
    const profile = await deps.profiles.get({ signal: ctx.signal })

    return buildSetRefusal(deps, field, openSegmentsOf(deps.profiles, profile))
  }

  const profile = await deps.profiles.update({
    patch,
    signal: ctx.signal,
  })

  return shown(deps, ctx, profile)
}

async function runReset(
  deps: ProfileCommandDeps,
  ctx: SlashContext,
  rest: readonly string[]
): Promise<SlashResult> {
  if (rest.length !== 0) {
    return usageFor(deps)
  }

  const profile = await deps.profiles.reset({
    signal: ctx.signal,
  })

  return shown(deps, ctx, profile)
}

async function runSegment(
  deps: ProfileCommandDeps,
  ctx: SlashContext,
  request: SegmentRequest
): Promise<SlashResult> {
  const profile = await deps.profiles.updateSegment({
    ...request,
    signal: ctx.signal,
  })

  return shown(deps, ctx, profile)
}

async function runPolicy(
  deps: ProfileCommandDeps,
  ctx: SlashContext,
  request: SegmentPolicyRequest
): Promise<SlashResult> {
  const profile = await deps.profiles.updateSegmentPolicy({
    ...request,
    signal: ctx.signal,
  })

  return shown(deps, ctx, profile)
}

/** Values come from the parser that accepts them, so the two cannot drift. A numeric field admits
 *  no list and completes to nothing. */
function completeProfile(deps: ProfileCommandDeps, args: readonly string[]): readonly string[] {
  if (args.length === 1) {
    return ACTIONS
  }

  const [action, field] = args

  if (parseMember(action, SEGMENT_TOGGLES) !== null) {
    return args.length === 2 ? deps.profiles.heldSegments() : []
  }

  if (action !== SET_ACTION) {
    return []
  }

  if (args.length === 2) {
    return fieldsOf(deps)
  }

  return field === undefined
    ? []
    : profileFieldValues({ field, index: args.length - 3, segments: deps.profiles.segments() })
}

/** One line a phone fits: what this field takes and an example of it, never the whole usage text. */
function buildSetRefusal(
  deps: ProfileCommandDeps,
  field: string,
  open: readonly PortfolioSegment[]
): SlashResult {
  return { kind: 'message', messages: [buildRefusalMessage(deps, field, open)] }
}

/** An example must run as typed, so it names a segment that is switched on. */
function openSegmentsOf(profiles: Profiles, profile: UserProfile): readonly PortfolioSegment[] {
  const off = disabledSegments(profile.caps)

  return profiles.heldSegments().filter((segment) => !off.has(segment))
}

function buildRefusalMessage(
  deps: ProfileCommandDeps,
  field: string,
  open: readonly PortfolioSegment[]
): CommandMessage {
  const shape = toFieldShape(field)

  if (shape === 'unknown') {
    const near = closestName(field, fieldsOf(deps))

    return near === undefined
      ? { key: 'slash.tradingProfileFieldUnknown', values: { field } }
      : { key: 'slash.tradingProfileFieldNear', values: { field, near } }
  }

  if (shape === 'choice') {
    const choices = profileFieldValues({ field, index: 0, segments: deps.profiles.segments() })

    return {
      key: 'slash.tradingProfileSetChoice',
      values: { field, values: choices.join(INLINE_SEPARATOR), example: choices[0] ?? '' },
    }
  }

  if (shape === 'share') {
    return { key: 'slash.tradingProfileSetShare', values: { field, example: EXAMPLE_SHARE } }
  }

  return {
    key: 'slash.tradingProfileSetSegment',
    values: { field, example: buildSegmentExample(field, open) },
  }
}

function buildSegmentExample(field: string, open: readonly PortfolioSegment[]): string {
  const [segment = SEGMENT_PLACEHOLDER] = open
  const isPolicy = parseMember(field, SEGMENT_POLICY_FIELDS) !== null
  const value = isPolicy ? EXAMPLE_SHARE : INVESTMENT_HORIZONS.at(-1)

  return `/profile set ${field} ${segment} ${value}`
}

/** The usage line names the segments a venue holds; a reference-only one is refused by name. */
function usageFor(deps: ProfileCommandDeps): SlashResult {
  return usage(usageKeyOf(deps), buildUsageValues(deps.profiles))
}

function usageKeyOf(deps: ProfileCommandDeps): CommandMessageKey {
  return deps.edition?.usage ?? USAGE
}

function fieldsOf(deps: ProfileCommandDeps): readonly ProfileSetField[] {
  return offeredFields(deps.edition?.fields)
}

function buildUsageValues(profiles: Profiles): CommandMessageValues {
  return {
    segments: profiles.heldSegments().join(INLINE_SEPARATOR),
    goals: GOAL_OPTIONS,
  }
}

/** A profile is a rendered section like every other surface, not a bag of messages: it carries a
 *  title, its own icon, and one idea per line. */
function shown(deps: ProfileCommandDeps, ctx: SlashContext, profile: UserProfile): SlashResult {
  return {
    kind: 'text',
    text: renderProfileText(ctx.locale, profile, {
      context: resolveRenderContext(deps.timezone, answerSurfaceOf(ctx)),
      homeSegment: deps.profiles.homeSegment(),
      fields: fieldsOf(deps),
    }),
  }
}
