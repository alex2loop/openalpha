import type { Locale } from '@/core/types/locale'
import type { SocialMembershipState } from '@/core/types/social'
import type {
  InstallPreview,
  LabelPolicy,
  PinChanges,
  SkillFinding,
  SocialEndpoint,
  SocialLabel,
} from '@/social/api'
import { warn } from '@/cli/ui/colors'
import { ValidationError } from '@/core/errors'
import { stripControls, toSingleLine } from '@/core/utils/text'
import { type MessageKey, t } from '@/i18n'
import { isSocialLabel, LABEL_POLICY, SOCIAL_LABELS } from '@/social/api'

const METHOD_PAD = 6
const LABEL_SPLIT = '='

/** One word per state, for a network's line and a member's. */
export const STATE_KEYS: Readonly<Record<SocialMembershipState, MessageKey>> = Object.freeze({
  active: 'cli.socialStateActive',
  paused: 'cli.socialStatePaused',
  refused: 'cli.socialStateRefused',
})

const POLICY_TEXT: Readonly<Record<LabelPolicy, MessageKey>> = Object.freeze({
  send: 'cli.socialPolicySend',
  'public-write': 'cli.socialPolicyPublicWrite',
  'always-send': 'cli.socialPolicyAlwaysSend',
  draft: 'cli.socialPolicyDraft',
  blocked: 'cli.socialPolicyBlocked',
})

/** `<METHOD> <path>=<label>`, split on the last `=`. */
export function parseLabelFlags(raw: readonly string[]): ReadonlyMap<string, SocialLabel> {
  const labels = new Map<string, SocialLabel>()

  for (const value of raw) {
    const cut = value.lastIndexOf(LABEL_SPLIT)
    const endpoint = cut < 0 ? '' : value.slice(0, cut).trim()
    const label = cut < 0 ? '' : value.slice(cut + 1).trim()

    if (endpoint === '' || !isSocialLabel(label)) {
      throw new ValidationError(`bad --label ${value}`, {
        key: 'cli.socialLabelFlag',
        params: { value, labels: SOCIAL_LABELS.join(', ') },
      })
    }

    labels.set(endpoint, label)
  }

  return labels
}

export function previewLines(
  locale: Locale,
  preview: InstallPreview,
  findings: readonly SkillFinding[] = preview.findings
): readonly string[] {
  const { pin } = preview
  const version =
    pin.version === undefined ? t(locale, 'cli.socialVersionUnknown') : clean(pin.version)

  return [
    t(locale, 'cli.socialPreviewHead', {
      network: pin.name,
      version,
      apiBase: clean(pin.apiBase),
    }),
    t(locale, 'cli.socialPreviewFiles', { files: Object.keys(pin.files).join(', ') }),
    t(locale, 'cli.socialPreviewEndpoints', { count: pin.endpoints.length }),
    ...pin.endpoints.map((endpoint) => endpointLine(locale, endpoint)),
    registerLine(locale, preview),
    ...findingLines(locale, findings),
  ]
}

function endpointLine(locale: Locale, endpoint: SocialEndpoint): string {
  const policy =
    endpoint.label === undefined
      ? t(locale, 'cli.socialPolicyUnlabelled')
      : t(locale, POLICY_TEXT[LABEL_POLICY[endpoint.label]])

  const method = endpoint.method.padEnd(METHOD_PAD)

  return `  ${method} ${clean(endpoint.path)}  ${endpoint.label ?? '-'}  ${policy}`
}

function registerLine(locale: Locale, preview: InstallPreview): string {
  const { register } = preview.pin

  return register === undefined
    ? t(locale, 'cli.socialPreviewNoRegister')
    : t(locale, 'cli.socialPreviewRegister', {
        path: clean(register.path),
        keyField: clean(register.keyField),
        claims: register.claimFields.map(clean).join(', '),
      })
}

function findingLines(locale: Locale, findings: readonly SkillFinding[]): readonly string[] {
  if (findings.length === 0) {
    return [t(locale, 'cli.socialPreviewClean')]
  }

  return [
    t(locale, 'cli.socialPreviewFindings', { count: findings.length }),
    ...findings.map((finding) => `  ${finding.file} · ${finding.kind} · ${clean(finding.excerpt)}`),
  ]
}

export function changeLines(locale: Locale, changes: PinChanges): readonly string[] {
  const lines: string[] = []

  if (changes.changedFiles.length > 0) {
    lines.push(t(locale, 'cli.socialChangedFiles', { files: changes.changedFiles.join(', ') }))
  }

  if (changes.removedFiles.length > 0) {
    lines.push(t(locale, 'cli.socialRemovedFiles', { files: changes.removedFiles.join(', ') }))
  }

  if (changes.newEndpoints.length > 0) {
    lines.push(t(locale, 'cli.socialNewEndpoints', { count: changes.newEndpoints.length }))
    lines.push(...changes.newEndpoints.map((endpoint) => endpointLine(locale, endpoint)))
  }

  if (changes.removedEndpoints.length > 0) {
    lines.push(t(locale, 'cli.socialRemovedEndpoints', { count: changes.removedEndpoints.length }))
  }

  if (changes.apiBaseChanged) {
    lines.push(warn(t(locale, 'cli.socialApiBaseChanged')))
  }

  return lines
}

/** A stranger's text on the operator's terminal. */
/** One value, one line: a newline in a network's text must not forge a preview line. */
function clean(text: string): string {
  return toSingleLine(stripControls(text))
}
