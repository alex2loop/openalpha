import type { Locale } from '@/core/types/locale'
import type { LLMUsageTotals } from '@/core/types/usage'
import type { FooterDetails } from '@/core/utils/footer'
import { colors } from '@/cli/ui/colors'
import { formatRunFooter } from '@/core/utils/footer'
import { t } from '@/i18n'

export function formatCliFooter(
  locale: Locale,
  totals: LLMUsageTotals,
  details: FooterDetails
): string {
  return colors.dim(
    formatRunFooter({ locale, translate: (key, values) => t(locale, key, values), totals, details })
  )
}
