import { scanSkill, type Threat } from '@/core/security/sanitize'
import { stripControls } from '@/core/utils/text'

type SkillFindingKind =
  | 'outside-host'
  | 'pipe-to-shell'
  | 'encoded'
  | 'eval'
  | 'installer'
  | 'local-file'
  | 'refetch'
  | 'key-elsewhere'
  | 'injection'

const EXFILTRATE_PATTERN = 'exfiltrate_credentials'
/** Measured on Moltbook 2026-10-12: `curl` fires on every API example, which says nothing about a
 *  social skill. Credential exfiltration fires on "never send your API key to any other domain",
 *  so it is kept only where the sentence is not a warning against it. */
const IGNORED_SKILL_PATTERNS: ReadonlySet<string> = new Set([EXFILTRATE_PATTERN, '\\bcurl\\b'])
const FINDING_EXCERPT_CHARS = 120
const NEGATED_RE = /\b(?:never|not|don'?t|do not)\b/i
const URL_HOST_RE = /https?:\/\/([^/\s"'`)<>]+)/g
const LINE_CHECKS: readonly { readonly kind: SkillFindingKind; readonly pattern: RegExp }[] = [
  { kind: 'pipe-to-shell', pattern: /\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/ },
  { kind: 'encoded', pattern: /\bbase64\b/i },
  { kind: 'eval', pattern: /\beval\b/ },
  {
    kind: 'installer',
    pattern: /\b(?:npm|npx|pnpm|yarn|pip3?|brew|apt(?:-get)?|bunx|cargo)\s+(?:install|add|i)\b/,
  },
  { kind: 'local-file', pattern: /(?:~\/|\$HOME|\.env\b|credentials\.json|id_rsa)/ },
  { kind: 'refetch', pattern: /(?:\b(?:curl|wget)\b[^\n]*\.(?:md|json)\b|skill\.json)/ },
]

export interface SkillFinding {
  readonly file: string
  readonly kind: SkillFindingKind
  readonly excerpt: string
}

interface SkillFileText {
  readonly name: string
  readonly text: string
}

interface ScanHosts {
  readonly apiHost: string
  readonly skillHost: string
}

/** Advisory: the operator reads these and decides. A placeholder token or a warning to keep the key
 *  private is not a finding. */
export function scanSocialSkill(file: SkillFileText, hosts: ScanHosts): readonly SkillFinding[] {
  return [
    ...outsideHosts(file, hosts),
    ...lineFindings(file, hosts.apiHost),
    ...[...scanSkill(file.text, IGNORED_SKILL_PATTERNS), ...exfiltration(file.text)].map((threat) =>
      finding(file.name, 'injection', `${threat.pattern}: ${threat.excerpt}`)
    ),
  ]
}

function exfiltration(text: string): readonly Threat[] {
  return scanSkill(text).filter(
    (threat) => threat.pattern === EXFILTRATE_PATTERN && !NEGATED_RE.test(threat.excerpt)
  )
}

function outsideHosts(file: SkillFileText, hosts: ScanHosts): readonly SkillFinding[] {
  const outside = new Set<string>()

  for (const match of file.text.matchAll(URL_HOST_RE)) {
    const host = match[1] ?? ''

    if (host !== hosts.apiHost && host !== hosts.skillHost) {
      outside.add(host)
    }
  }

  return [...outside].map((host) => finding(file.name, 'outside-host', host))
}

function lineFindings(file: SkillFileText, apiHost: string): readonly SkillFinding[] {
  const found: SkillFinding[] = []

  for (const line of file.text.split('\n')) {
    const check = LINE_CHECKS.find((candidate) => candidate.pattern.test(line))

    if (check !== undefined) {
      found.push(finding(file.name, check.kind, line))
    }

    if (line.includes('Authorization') && hasOtherHost(line, apiHost)) {
      found.push(finding(file.name, 'key-elsewhere', line))
    }
  }

  return found
}

function hasOtherHost(line: string, apiHost: string): boolean {
  return [...line.matchAll(URL_HOST_RE)].some((match) => match[1] !== apiHost)
}

function finding(file: string, kind: SkillFindingKind, raw: string): SkillFinding {
  return { file, kind, excerpt: stripControls(raw).trim().slice(0, FINDING_EXCERPT_CHARS) }
}
