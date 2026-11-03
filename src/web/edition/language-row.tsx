import { chooseLanguage, currentLocale } from '@/web/edition/worker-link'
import { tr } from '@/web/text/tr'
import { askConfirm } from '@/web/ui/kit/confirm'
import { Segmented } from '@/web/ui/kit/segmented'
import { ActionRow } from '@/web/ui/settings/row'

const LANGUAGES = Object.freeze(['vi', 'en'] as const)
const LANGUAGE_LABELS = Object.freeze({
  vi: 'ui.office.settings.langVi',
  en: 'ui.office.settings.langEn',
} as const)

/** Ngôn ngữ: the engine reads its language once, when it starts, so a new one restarts it. That
 *  stops the work in flight, so the visitor is asked first. */
export function LanguageRow() {
  const title = tr('ui.office.settings.language')

  return (
    <ActionRow title={title} note={tr('ui.office.edition.language.note')}>
      <Segmented
        label={title}
        value={currentLocale()}
        options={LANGUAGES.map((value) => ({ value, label: tr(LANGUAGE_LABELS[value]) }))}
        onChange={(next) => {
          if (next === currentLocale()) {
            return
          }

          askConfirm({
            title: tr('ui.office.edition.restart.title'),
            lines: [tr('ui.office.edition.restart.body'), tr('ui.office.edition.restart.kept')],
            confirmLabel: tr('ui.office.edition.language.confirm'),
            keepLabel: tr('ui.office.edition.common.later'),
            confirm: () => chooseLanguage(next),
          })
        }}
      />
    </ActionRow>
  )
}
