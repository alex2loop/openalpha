import type { ArgIssue } from '@/cli/parsing/args'
import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import { t } from '@/i18n'

const ISSUE_KEYS = {
  unknown_flag: 'cliHelp.issueUnknownFlag',
  missing_value: 'cliHelp.issueMissingValue',
  missing_positional: 'cliHelp.issueMissingArgument',
  extra_positional: 'cliHelp.issueUnexpectedArgument',
  invalid_choice: 'cliHelp.issueInvalidValue',
  conflicting_flags: 'cliHelp.issueConflictingFlags',
} satisfies Record<ArgIssue['code'], MessageKey>

export function formatArgIssue(locale: Locale, issue: ArgIssue): string {
  return t(locale, ISSUE_KEYS[issue.code], {
    token: issue.token,
    value: issue.value ?? '',
  })
}
