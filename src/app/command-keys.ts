import type { KeyValidator } from '@/commands/api'
import { hasOwnMessage } from '@/i18n'

/** The one locale gate: every contributed command key must resolve in both catalogs. */
export const commandKeyValidator: KeyValidator = {
  resolvesEverywhere: (key) => hasOwnMessage('en', key) && hasOwnMessage('vi', key),
}
