import type { MessageKey } from '@/i18n'
import type { RestartRow, SettingsSection } from '@/web/state/settings'
import { joinList } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

const ROW_TITLES = Object.freeze({
  models: 'ui.office.settings.models',
  budget: 'ui.office.settings.budget',
  language: 'ui.office.settings.language',
  timeZone: 'ui.office.settings.timeZone',
  raw: 'ui.office.advanced.title',
} as const satisfies Record<RestartRow, MessageKey>)

const ROW_SECTIONS = Object.freeze({
  models: 'agents',
  budget: 'agents',
  language: 'display',
  timeZone: 'display',
  raw: 'advanced',
} as const satisfies Record<RestartRow, SettingsSection>)

/** The rows in the operator's words, as one list. */
export function describeRows(rows: readonly RestartRow[]): string {
  return joinList(rows.map((row) => tr(ROW_TITLES[row])))
}

/** Where to look at the first of these rows. */
export function sectionOfRows(rows: readonly RestartRow[]): SettingsSection | undefined {
  const [first] = rows

  return first === undefined ? undefined : ROW_SECTIONS[first]
}
