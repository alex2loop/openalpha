import type { MessageKey } from '@/i18n'
import { tr } from '@/web/text/tr'

// The channels the page names itself; any other raw channel id is named as it comes.
const SOURCE_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
  api: 'ui.office.jobs.from.api',
  telegram: 'ui.office.jobs.from.telegram',
  cli: 'ui.office.jobs.from.cli',
  cron: 'ui.office.jobs.from.cron',
})

/** Where a run or a request came from, by its raw `channelId`. */
export function sourceLabel(channelId: string): string {
  const key = Object.hasOwn(SOURCE_KEYS, channelId) ? SOURCE_KEYS[channelId] : undefined

  return key === undefined ? tr('ui.office.jobs.from.other', { channel: channelId }) : tr(key)
}
