import type { Threat } from '@/core/security/sanitize'
import { hasLikelySecret } from '@/core/security/credentials'
import { hasBlockingThreat, scanSkill } from '@/core/security/sanitize'

export type Verdict = 'safe' | 'caution' | 'dangerous'
export type Trust = 'local' | 'trusted' | 'community'

interface SkillContentVerdict {
  readonly verdict: Verdict
  readonly findings: readonly Threat[]
}

const SECRET_FINDING: Threat = {
  pattern: 'likely_secret',
  excerpt: '[redacted]',
  severity: 'block',
}

// A leaked credential forces `dangerous` regardless of the injection scan. Shared by `skill install`
// and `skill_view` so both paths agree.
export function evaluateSkillContent(text: string): SkillContentVerdict {
  const threats = scanSkill(text)
  const findings = hasLikelySecret(text) ? [...threats, SECRET_FINDING] : threats

  return { verdict: verdictOf(findings), findings }
}

export function isAllowed(trust: Trust, verdict: Verdict, force: boolean): boolean {
  if (force || trust === 'local') {
    return true
  }

  if (trust === 'trusted') {
    return verdict !== 'dangerous'
  }

  return verdict === 'safe'
}

function verdictOf(findings: readonly Threat[]): Verdict {
  if (hasBlockingThreat(findings)) {
    return 'dangerous'
  }

  return findings.length > 0 ? 'caution' : 'safe'
}
