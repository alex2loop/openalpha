import type { Locale } from '@/core/types/locale'
import { type MessageKey, t } from '@/i18n'

export const CHECK_NAMES = [
  'config',
  'models',
  'data-dir',
  'logging',
  'database',
  'daemon',
  'channels',
  'delivery',
  'sources',
  'trading',
  'venues',
  'web-search',
  'providers',
  'telegram',
  'zalo',
  'version',
] as const

export type CheckName = (typeof CHECK_NAMES)[number]

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
