import { tr } from '@/web/text/tr'
import { askConfirm } from '@/web/ui/kit/confirm'

interface RestartAsk {
  readonly confirmLabel: string
  /** Runs on the visitor's yes: the change that restarts the engine. */
  readonly confirm: () => Promise<void> | void
}

/** The question before a change that restarts the engine (a new language, new model tiers): the
 *  restart stops the work in flight, so the visitor is asked first. */
export function askRestart({ confirmLabel, confirm }: RestartAsk): void {
  askConfirm({
    title: tr('ui.office.edition.restart.title'),
    lines: [tr('ui.office.edition.restart.body'), tr('ui.office.edition.restart.kept')],
    confirmLabel,
    keepLabel: tr('ui.office.edition.common.later'),
    confirm,
  })
}
