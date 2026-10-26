import type { CheckName } from '@/core/types/doctor'
import type { Locale } from '@/core/types/locale'
import { type MessageKey, t } from '@/i18n'

import type { DoctorSurface } from './types'

const CHECK_LABEL_KEYS = {
  config: 'cli.doctorLabelConfig',
  models: 'cli.doctorLabelModels',
  'data-dir': 'cli.doctorLabelDataDir',
  logging: 'cli.doctorLabelLogging',
  database: 'cli.doctorLabelDatabase',
  daemon: 'cli.doctorLabelDaemon',
  channels: 'cli.doctorLabelChannels',
  delivery: 'cli.doctorLabelDelivery',
  sources: 'cli.doctorLabelSources',
  trading: 'cli.doctorLabelTrading',
  safety: 'cli.doctorLabelSafety',
  venues: 'cli.doctorLabelVenues',
  'web-search': 'cli.doctorLabelWebSearch',
  providers: 'cli.doctorLabelProviders',
  telegram: 'cli.doctorLabelTelegram',
  zalo: 'cli.doctorLabelZalo',
  version: 'cli.doctorLabelVersion',
} as const satisfies Record<CheckName, MessageKey>

const SUBJECT_LABEL_KEYS = {
  channel: 'cli.doctorLabelChannel',
  venue: 'cli.doctorLabelVenue',
  login: 'cli.doctorLabelLogin',
} as const satisfies Record<string, MessageKey>

type SubjectKind = keyof typeof SUBJECT_LABEL_KEYS

/** The row label of a check, in the operator's language. The check name stays the argument
 *  `doctor <check>` takes. */
export function checkLabel(locale: Locale, check: CheckName): string {
  return t(locale, CHECK_LABEL_KEYS[check])
}

/** A row about one named thing a check found: a channel, a venue, a provider login. */
export function subjectLabel(locale: Locale, kind: SubjectKind, subject: string): string {
  return t(locale, SUBJECT_LABEL_KEYS[kind], { subject })
}

/** The lines a check writes when it did not go online: the terminal names the flag, the page its
 *  button, and the page never makes a model call at all. */
const OFFLINE_KEYS = {
  terminal: {
    notProbed: 'cli.doctorNotProbed',
    providers: 'cli.doctorNotProbed',
    webSearch: 'cli.doctorWebSearchOffline',
    neverChecked: 'cli.updateNeverChecked',
  },
  page: {
    notProbed: 'cli.doctorNotProbedPage',
    providers: 'cli.doctorProvidersNoCall',
    webSearch: 'cli.doctorWebSearchOfflinePage',
    neverChecked: 'cli.updateNeverCheckedPage',
  },
} as const satisfies Record<DoctorSurface, Record<string, MessageKey>>

type OfflineLine = keyof (typeof OFFLINE_KEYS)['terminal']

export function offlineKey(surface: DoctorSurface, line: OfflineLine): MessageKey {
  return OFFLINE_KEYS[surface][line]
}
