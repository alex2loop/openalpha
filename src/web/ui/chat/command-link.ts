import type { MessageKey } from '@/i18n'
import { COST_POPOVER_ID } from '@/web/ui/cost/cost-popover'
import { togglePopover } from '@/web/ui/kit/popover'

const WORD_BREAK = /\s+/

interface CommandLink {
  readonly label: MessageKey
  readonly open: () => void
}

// The screen that holds the rest of a command's answer, by the command as typed.
const COMMAND_LINKS: Readonly<Record<string, CommandLink>> = Object.freeze({
  '/cost': { label: 'ui.office.chat.link.cost', open: () => togglePopover(COST_POPOVER_ID) },
})

/** The link for the command `text` starts with; none for a question or an unlisted command. */
export function resolveCommandLink(text: string): CommandLink | undefined {
  const [name = ''] = text.trim().split(WORD_BREAK, 1)

  return Object.hasOwn(COMMAND_LINKS, name) ? COMMAND_LINKS[name] : undefined
}
