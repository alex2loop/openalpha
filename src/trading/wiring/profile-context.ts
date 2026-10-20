import type { Hooks, LLMRequestModifier } from '@/engine/api'
import type { RiskCapSet, UserProfile } from '@/trading/kernel/operator/profile'
import { escapeXml } from '@/core/security/sanitize'
import { appendSystemBlock } from '@/engine/api'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { isSegmentDisabled } from '@/trading/kernel/operator/profile'
import { promptPercent } from '@/trading/prompt-text'

const PROFILE_TOOL = 'profile_update'
const MAXIMUM_LISTED_INSTRUMENTS = 20

/** The hook's narrow read: `null` for an absent profile, and never a write. A read that creates a
 *  row is how a hook ends up seeding defaults for a user who never engaged with the product. */
interface ProfileReader {
  find(signal: AbortSignal): Promise<UserProfile | null>
}

export function createTradingHooks(profiles: ProfileReader): Pick<Hooks, 'llmRequestModifiers'> {
  return { llmRequestModifiers: [profileContextModifier(profiles)] }
}

function profileContextModifier(profiles: ProfileReader): LLMRequestModifier {
  return async (run, req) => {
    // A delegated child inherits its parent's framing; injecting the block again would spend
    // context on every fan-out leg and let a child act on advice its parent already has.
    if (run.env.callDepth > 0 || !run.env.agent.tools.includes(PROFILE_TOOL)) {
      return req
    }

    const profile = await profiles.find(run.state.abort.signal)

    if (profile === null) {
      return appendSystemBlock(req, missingProfileBlock())
    }

    return appendSystemBlock(req, profileBlock(profile))
  }
}

function missingProfileBlock(): string {
  return [
    '<investor_profile status="absent">',
    'No profile is stored. Before advice that depends on risk, horizons, or goal, ask once for',
    'risk appetite, horizon, and goal, then persist the answer with',
    `${PROFILE_TOOL}({patch:{riskLevel,horizons,goal}}). No other tool stores these facts.`,
    '</investor_profile>',
  ].join('\n')
}

/** Relative facts only — weights, percentages, and codes. The absent absolute fields are not a
 *  redaction step: `UserProfile` has no balance to leak. */
function profileBlock(profile: UserProfile): string {
  const lines = [
    '<investor_profile status="stored">',
    `risk: ${escapeXml(profile.riskLevel)} (capacity ${escapeXml(profile.riskCapacity)}, willingness ${escapeXml(profile.riskWillingness)})`,
    `horizons: ${formatHorizons(profile)}`,
    `goal: ${escapeXml(profile.goal)}`,
    `watchlist: ${formatRefs(profile.watchlist)}`,
    `exclusions: ${formatRefs(profile.exclusions)}`,
    `reserve: ${promptPercent(profile.reservePctNav)} of NAV`,
    `risk per trade: ${promptPercent(profile.riskPerTradePctNav)} of NAV`,
    `maximum open risk: ${promptPercent(profile.maximumOpenRiskPctNav)} of NAV`,
    `sector cap: ${promptPercent(profile.maximumSectorPctNav)} of NAV`,
    `segment targets: ${formatSegmentTargets(profile)}`,
    `segment caps: ${formatSegmentCaps(profile)}`,
    `regime scale ceiling: ${promptPercent(profile.regimeScale)}`,
  ]

  lines.push(
    `Persist newly stated durable preferences with ${PROFILE_TOOL}. No other tool stores these facts.`,
    '</investor_profile>'
  )

  return lines.join('\n')
}

function formatSegmentTargets(profile: UserProfile): string {
  return Object.entries(profile.segmentTargets)
    .map(([segment, target]) => `${escapeXml(segment)}=${promptPercent(target)}`)
    .join(', ')
}

function formatHorizons(profile: UserProfile): string {
  return Object.entries(profile.horizons)
    .map(([segment, horizon]) => `${escapeXml(segment)}=${escapeXml(horizon)}`)
    .join(', ')
}

function formatSegmentCaps(profile: UserProfile): string {
  return Object.entries(profile.caps)
    .map(([segment, caps]) => `${escapeXml(segment)}=${formatCapSet(caps)}`)
    .join(', ')
}

function formatCapSet(caps: RiskCapSet): string {
  if (isSegmentDisabled(caps)) {
    return 'off, never suggest or size a name in it'
  }

  return `position ${promptPercent(caps.maximumPositionPctNav)}, segment ${promptPercent(caps.maximumSegmentPctNav)}`
}

function formatRefs(refs: UserProfile['watchlist']): string {
  if (refs.length === 0) {
    return 'none'
  }

  const shown = refs
    .slice(0, MAXIMUM_LISTED_INSTRUMENTS)
    .map((ref) => escapeXml(buildInstrumentKey(ref)))
    .join(', ')
  const dropped = refs.length - Math.min(refs.length, MAXIMUM_LISTED_INSTRUMENTS)

  return dropped === 0 ? shown : `${shown} (+${dropped} more)`
}
