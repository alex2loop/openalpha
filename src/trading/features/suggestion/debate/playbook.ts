import type { DebateInput } from '@/trading/features/suggestion/pipeline/types'
import type { DebateRole } from '@/trading/kernel/config'
import type { InstrumentKind } from '@/trading/kernel/instrument'
import type { MarketPlaybook, SkillName } from '@/trading/kernel/skill'
import type { MarketManifest } from '@/trading/markets/types'
import { toSkillBody } from '@/engine/api'
import { DEBATE_MODE_ROLES } from '@/trading/kernel/config'
import { ETF_KIND } from '@/trading/kernel/instrument'

const PLAYBOOK_HEADING =
  'PLAYBOOK - the methods you apply to this question. Follow them as written.'
const PLAYBOOK_SEPARATOR = '\n\n---\n\n'

/** Every skill as prompt body, keyed by name. Total by type, so selecting a name can never miss. */
export type PlaybookLibrary = Readonly<Record<SkillName, string>>

/** Strips each skill once at composition rather than on every role call. */
export function toPlaybookLibrary(skills: Readonly<Record<SkillName, string>>): PlaybookLibrary {
  // why-safe: `skills` is annotated total over `SkillName`, and mapping values preserves its keys.
  return Object.freeze(
    Object.fromEntries(Object.entries(skills).map(([name, text]) => [name, toSkillBody(text)]))
  ) as PlaybookLibrary
}

interface RolePlaybook {
  /** What this role reads whatever the market trades. */
  readonly shared: readonly SkillName[]
  /** Which arm of the market's own playbook it reads, where it reads one at all. */
  readonly market?: 'analysis' | 'execution'
}

/**
 * What each role is handed before it answers. The roles are given their playbooks rather than
 * offered them: a persona carries no tools, so there is no call to skip, and a model too weak to
 * choose a skill out of a catalogue is exactly the one that most needs the method. Selecting here
 * also keeps the schema contract enforceable, which a tool-bearing request gives up.
 *
 * Keep each list short. Everything here is paid for on every call of that role, and a role reading
 * five methods applies none of them well.
 */
const ROLE_PLAYBOOK: Readonly<Record<DebateRole, RolePlaybook>> = Object.freeze({
  'bull-researcher': { shared: ['behavioral-finance'], market: 'analysis' },
  'bear-researcher': {
    shared: ['behavioral-finance', 'crowding-and-unwind', 'inversion'],
    market: 'analysis',
  },
  'market-analyst': { shared: ['behavioral-finance', 'crowding-and-unwind'], market: 'analysis' },
  'portfolio-manager': { shared: ['portfolio-risk-analysis', 'correlation-analysis'] },
  trader: { shared: ['technical-analysis'], market: 'execution' },
  'risk-analyst': { shared: ['portfolio-risk-analysis', 'exit-management'] },
  // Checking a claim against supplied evidence is the one role a method would only bias: it reads
  // what it was handed and returns one of three verdicts.
  'claim-verifier': { shared: [] },
})

/** The skills one role reads for this market and instrument kind, in a stable order and never
 *  repeated. */
export function rolePlaybook(
  role: DebateRole,
  manifest: MarketManifest,
  kind?: InstrumentKind
): readonly SkillName[] {
  const spec = ROLE_PLAYBOOK[role]

  return [...new Set([...spec.shared, ...marketSkills(spec, manifest.playbook, kind)])]
}

function marketSkills(
  spec: RolePlaybook,
  playbook: MarketPlaybook,
  kind: InstrumentKind | undefined
): readonly SkillName[] {
  if (spec.market === 'analysis' && kind === ETF_KIND && playbook.fundAnalysis !== undefined) {
    return playbook.fundAnalysis
  }

  return spec.market === undefined ? [] : (playbook[spec.market] ?? [])
}

/**
 * Every skill this debate's roles read, which is what a completed debate records. Derived rather
 * than collected: `finish` builds a result only once every role of the mode has answered, so the
 * union over the mode is exactly what was applied.
 */
export function debatePlaybook(
  input: Pick<DebateInput, 'depth' | 'draft'>,
  manifest: MarketManifest
): readonly string[] {
  const kind = input.draft.instrumentKind
  const roles = DEBATE_MODE_ROLES[input.depth.mode]

  return [...new Set(roles.flatMap((role) => rolePlaybook(role, manifest, kind)))].sort()
}

/** The prompt block for one role. Empty where the role reads nothing, so no heading is printed. */
export function renderPlaybook(
  skills: readonly SkillName[],
  library: PlaybookLibrary,
  instructions: string
): string {
  if (skills.length === 0) {
    return instructions
  }

  return [PLAYBOOK_HEADING, ...skills.map((skill) => library[skill]), instructions].join(
    PLAYBOOK_SEPARATOR
  )
}
