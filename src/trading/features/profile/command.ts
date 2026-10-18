import type {
  CommandMessageValues,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type {
  ProfileService,
  SegmentPolicyRequest,
  SegmentRequest,
} from '@/trading/features/profile/types'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import {
  PROFILE_SET_FIELDS,
  parseProfilePatch,
  parseSegmentPolicyRequest,
  profileFieldValues,
} from '@/trading/features/profile/patch'
import { renderProfileText } from '@/trading/features/profile/render'
import { SEGMENT_TOGGLES } from '@/trading/features/profile/types'
import { INVESTMENT_GOALS } from '@/trading/kernel/operator/profile'
import { parseMember, usage } from '@/trading/kernel/surface/surface'
import { resolveRenderContext } from '@/trading/render/format'
import { INLINE_SEPARATOR } from '@/trading/render/layout'

const USAGE: 'slash.tradingProfileUsage' = 'slash.tradingProfileUsage'
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
  'get' | 'update' | 'reset' | 'segments' | 'heldSegments' | 'updateSegment' | 'updateSegmentPolicy'
>

interface ProfileCommandDeps {
  readonly profiles: Profiles
  readonly timezone: string
}

export function createProfileCommand(deps: ProfileCommandDeps): SlashCommand {
  return {
    name: 'profile',
    description: { kind: 'localized', key: 'slash.tradingProfileHelp' },
    messageKeys: [USAGE],
    policy: { surfaces: ['channel', 'repl'], role: 'operator', action: 'mutate' },
    completeFor: (args) => completeProfile(deps.profiles, args),
    usage: () => ({ key: USAGE, values: buildUsageValues(deps.profiles) }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: ProfileCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [action, ...rest] = ctx.args

  if (action === SHOW_ACTION) {
    return rest.length === 0 ? runShow(deps, ctx) : usageFor(deps.profiles)
  }

  if (action === SET_ACTION) {
    return runSet(deps, ctx, rest)
  }

  if (action === RESET_ACTION) {
    return runReset(deps, ctx, rest)
  }

  const kind = parseMember(action, SEGMENT_TOGGLES)

  if (kind === null) {
    return usageFor(deps.profiles)
  }

  const segment = rest.length === 1 ? parseMember(rest[0], deps.profiles.segments()) : null

  return segment === null ? usageFor(deps.profiles) : runSegment(deps, ctx, { kind, segment })
}

async function runShow(deps: ProfileCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const profile = await deps.profiles.get({
    defaultLocale: ctx.locale,
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
    return usageFor(deps.profiles)
  }

  const segments = deps.profiles.segments()
  const policy = parseSegmentPolicyRequest({ field, values, segments })

  if (policy !== null) {
    return runPolicy(deps, ctx, policy)
  }

  const patch = parseProfilePatch({ field, values, segments })

  if (patch === null) {
    return usageFor(deps.profiles)
  }

  const profile = await deps.profiles.update({
    patch,
    defaultLocale: ctx.locale,
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
    return usageFor(deps.profiles)
  }

  const profile = await deps.profiles.reset({
    defaultLocale: ctx.locale,
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
    defaultLocale: ctx.locale,
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
    defaultLocale: ctx.locale,
    signal: ctx.signal,
  })

  return shown(deps, ctx, profile)
}

/** Values come from the parser that accepts them, so the two cannot drift. A numeric field admits
 *  no list and completes to nothing. */
function completeProfile(profiles: Profiles, args: readonly string[]): readonly string[] {
  if (args.length === 1) {
    return ACTIONS
  }

  const [action, field] = args

  if (parseMember(action, SEGMENT_TOGGLES) !== null) {
    return args.length === 2 ? profiles.heldSegments() : []
  }

  if (action !== SET_ACTION) {
    return []
  }

  if (args.length === 2) {
    return PROFILE_SET_FIELDS
  }

  return field === undefined
    ? []
    : profileFieldValues({ field, index: args.length - 3, segments: profiles.segments() })
}

/** The usage line names the segments a venue holds; a reference-only one is refused by name. */
function usageFor(profiles: Profiles): SlashResult {
  return usage(USAGE, buildUsageValues(profiles))
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
    text: renderProfileText(ctx.locale, profile, resolveRenderContext(deps.timezone, ctx.surface)),
  }
}
