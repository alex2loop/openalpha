import type { InboundHandlerDeps } from '@/channels/delivery/types'
import type { OutboundButton } from '@/channels/types'
import type { Affordance } from '@/core/types/command'
import { TELEGRAM_CALLBACK_DATA_MAX_BYTES } from '@/channels/adapters/telegram/protocol'
import { COMMAND_CALLBACK_ACTION } from '@/channels/delivery/callbacks'
import { t } from '@/i18n'

/** What the reader could run next, rendered the way the destination can carry it: a keyboard where
 *  the channel has one, lines they can type where it does not. Nothing exists only as a button, so
 *  a payload too large for the wire degrades to a line rather than disappearing. */
export function offeredNext(
  deps: InboundHandlerDeps,
  affordances: readonly Affordance[]
): { readonly buttons: readonly OutboundButton[]; readonly lines: readonly string[] } {
  const buttons: OutboundButton[] = []
  const lines: string[] = []

  for (const affordance of affordances) {
    const callbackId = `${COMMAND_CALLBACK_ACTION}${affordance.command}`

    if (deps.adapter.capabilities.inlineButtons && fitsCallbackData(callbackId)) {
      buttons.push({ label: labelOf(affordance), callbackId })
      continue
    }

    lines.push(
      t(deps.locale, 'channel.affordanceLine', {
        label: labelOf(affordance),
        command: affordance.command,
      })
    )
  }

  return { buttons, lines }
}

function labelOf(affordance: Affordance): string {
  return affordance.icon === undefined ? affordance.label : `${affordance.icon} ${affordance.label}`
}

function fitsCallbackData(callbackId: string): boolean {
  return new TextEncoder().encode(callbackId).length <= TELEGRAM_CALLBACK_DATA_MAX_BYTES
}

export function joinLines(body: string, lines: readonly string[]): string {
  return lines.length === 0 ? body : [body, '', ...lines].join('\n')
}
