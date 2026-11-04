import { tr } from '@/web/text/tr'
import { askConfirm } from '@/web/ui/kit/confirm'

interface RestartAsk {
  readonly confirmLabel: string
  /** The change removes something: "keep" becomes the main button. */
  readonly isDestructive?: true | undefined
  /** Runs on the visitor's yes: the change that restarts the engine. */
  readonly confirm: () => Promise<void> | void
}

/** The question before a change that restarts the engine (a new language, new model tiers, venues): the
 *  restart stops the work in flight, so the visitor is asked first. */
export function askRestart({ confirmLabel, isDestructive, confirm }: RestartAsk): void {
  askConfirm({
    title: tr('ui.office.edition.restart.title'),
    lines: [tr('ui.office.edition.restart.body'), tr('ui.office.edition.restart.kept')],
    confirmLabel,
    ...(isDestructive === true ? { isDestructive } : {}),
    keepLabel: tr('ui.office.edition.common.later'),
    confirm,
  })
}
