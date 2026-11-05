import type { ResearchResult } from './contracts'
import type { EvidenceGap } from './evidence/gaps'
import type { EvidenceExcerpt, ResearchArtifact, ResearchClaim } from './evidence/model'
import { toResearchIssueKind } from './display/issue-summary'
import { independentSupportCounts } from './evidence/corroboration'

const MAX_AGENT_GAPS = 6
const AGENT_STAGE_GAP_RESERVE = 1

type CompletedResult = Extract<ResearchResult, { readonly status: 'complete' }>

type UnfinishedResult = Exclude<ResearchResult, { readonly status: 'complete' }>

/** Excerpt provenance without the page prose it quotes. */
type AgentEvidenceExcerpt = Omit<EvidenceExcerpt, 'text'>

/** A claim plus how many independent publishers stand behind it, syndicated copies collapsed. */
type AgentResearchClaim = ResearchClaim & { readonly independentSources: number }

interface AgentResearchArtifact
  extends Omit<ResearchArtifact, 'excerpts' | 'retrievalAttempts' | 'claims'> {
  readonly excerpts: readonly AgentEvidenceExcerpt[]
  readonly claims: readonly AgentResearchClaim[]
}

type AgentResearchResult =
  | (Omit<CompletedResult, 'artifact'> & { readonly artifact: AgentResearchArtifact })
  | UnfinishedResult

/**
 * The research result as the calling agent reads it. Excerpt text is withheld: it is verbatim page
 * prose carrying figures the numeric grounding check deliberately refused, and an agent handed it
 * will quote those figures as findings. Ids stay, so claim to excerpt to source is still traceable.
 * Retrieval attempts are run diagnostics with no answer in them.
 *
 * Both shapes are written out field by field on purpose: a field added to the artifact fails this
 * file to compile rather than reaching the agent unreviewed.
 *
 * `independentSources` is derived at this boundary, never stored: it is a view of the graph, not evidence.
 */
export function toAgentResearchResult(result: ResearchResult): AgentResearchResult {
  if (result.status !== 'complete') {
    return result
  }

  const support = independentSupportCounts(result.artifact)

  return {
    ...result,
    artifact: {
      sources: result.artifact.sources,
      excerpts: result.artifact.excerpts.map(toAgentExcerpt),
      claims: result.artifact.claims.map((claim) => ({
        ...claim,
        independentSources: support.get(claim.id) ?? 0,
      })),
      numericLinks: result.artifact.numericLinks,
      gaps: toAgentGaps(result.artifact.gaps),
      conflicts: result.artifact.conflicts,
      report: result.artifact.report,
    },
  }
}

/**
 * The agent writes what is missing from these, so a long list reads as noise. Gaps about the evidence
 * come first and the list is bounded, but room is kept for a stage problem: a failed search explains
 * an empty or thin answer. An unverified label is the only record that a claim is unconfirmed, so
 * every one of them travels whatever the bound.
 */
function toAgentGaps(gaps: readonly EvidenceGap[]): readonly EvidenceGap[] {
  const labels = gaps.filter((gap) => gap.code === 'unverified_claim')
  const others = gaps.filter((gap) => gap.code !== 'unverified_claim')
  const evidence = others.filter((gap) => toResearchIssueKind(gap) === 'evidence')
  const stage = others.filter((gap) => toResearchIssueKind(gap) === 'run')
  const room = MAX_AGENT_GAPS - AGENT_STAGE_GAP_RESERVE
  const ranked = [...evidence.slice(0, room), ...stage, ...evidence.slice(room)]

  return [...ranked.slice(0, MAX_AGENT_GAPS), ...labels]
}

function toAgentExcerpt(excerpt: EvidenceExcerpt): AgentEvidenceExcerpt {
  return {
    id: excerpt.id,
    sourceId: excerpt.sourceId,
    locator: excerpt.locator,
    textHash: excerpt.textHash,
    retrievedAt: excerpt.retrievedAt,
    truncated: excerpt.truncated,
    safety: excerpt.safety,
  }
}
