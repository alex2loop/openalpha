import type { DebateContext } from '@/trading/features/suggestion/debate/call'
import type { ArguingRole } from '@/trading/features/suggestion/debate/claims'
import type {
  DebateResult,
  ResearchCase,
  RoleOutput,
} from '@/trading/features/suggestion/debate/types'
import { formatErrForLog } from '@/core/security/credentials'
import { isClaimBy } from '@/trading/features/suggestion/debate/claims'

type RoleDraft = Omit<RoleOutput, 'ticker' | 'market'>

/** Tells the listener what every role said, in the order the roles ran. A listener that throws is
 *  logged once for the debate and never stops the rest. */
export function reportRoleOutputs(
  context: DebateContext,
  result: DebateResult,
  refuted: ReadonlySet<string>
): void {
  const { instrument } = context.input.draft

  try {
    for (const draft of toRoleDrafts(result, refuted)) {
      context.deps.onRoleOutput({ ticker: instrument.ticker, market: instrument.market, ...draft })
    }
  } catch (err: unknown) {
    context.deps.logger.warn('trading.role_output_failed', { err: formatErrForLog(err) })
  }
}

function toRoleDrafts(result: DebateResult, refuted: ReadonlySet<string>): readonly RoleDraft[] {
  const verifier: RoleDraft = {
    role: 'claim-verifier',
    citations: result.verification.verified.filter((entry) => entry.citation !== undefined).length,
    unsupported: false,
  }

  if (result.mode === 'lean') {
    return [argued('market-analyst', result.analyst, { result, refuted }), verifier]
  }

  const { portfolioManager, trader, risk } = result

  return [
    argued('bull-researcher', result.bull, { result, refuted }),
    argued('bear-researcher', result.bear, { result, refuted }),
    {
      role: 'portfolio-manager',
      stance: portfolioManager.verdict,
      summary: portfolioManager.rationale,
      citations: 0,
      unsupported: false,
    },
    {
      role: 'trader',
      stance: trader.stance,
      summary: trader.entryTiming,
      citations: 0,
      unsupported: false,
    },
    {
      role: 'risk-analyst',
      stance: risk.verdict,
      ...(risk.notes[0] === undefined ? {} : { summary: risk.notes[0] }),
      citations: 0,
      unsupported: false,
    },
    verifier,
  ]
}

interface Checked {
  readonly result: DebateResult
  readonly refuted: ReadonlySet<string>
}

function argued(role: ArguingRole, source: ResearchCase, checked: Checked): RoleDraft {
  const own = checked.result.claims.filter((claim) => isClaimBy(role, claim))
  const unsupported = own.length > 0 && own.every((claim) => checked.refuted.has(claim.id))

  return {
    role,
    stance: source.stance,
    ...(unsupported ? {} : { summary: source.summary }),
    citations: source.citations.length,
    unsupported,
  }
}
