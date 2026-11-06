import type { Locale, Translate } from '@/web/brief/strings'
import { Segmented } from '@/web/ui/kit/segmented'

interface LanguageSwitchProps {
  readonly t: Translate
  readonly locale: Locale
  readonly onLocale: (locale: Locale) => void
}

/** The two languages of the app, one pressed. */
export function LanguageSwitch({ t, locale, onLocale }: LanguageSwitchProps) {
  return (
    <Segmented
      label={t('ui.brief.languageLabel')}
      value={locale}
      options={[
        { value: 'vi', label: t('ui.brief.language.vi') },
        { value: 'en', label: t('ui.brief.language.en') },
      ]}
      onChange={onLocale}
    />
  )
}
