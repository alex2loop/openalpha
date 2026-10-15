import type { Locale } from '@/core/types/locale'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { t } from '@/i18n'
import { formatCount, renderDeclaredValue, renderProvidedValue } from '@/trading/render/format'

const TASK_NAME_PREFIX = 'trading.'

/** A paused or stopped loop, named the way the operator knows it, never by its task id. */
export function renderLoopQuarantineNotice(
  locale: Locale,
  taskName: string,
  retryInMs?: number
): string {
  const operation = renderProvidedValue(
    locale,
    `trading.loop.${taskName.replace(TASK_NAME_PREFIX, '')}`,
    renderDeclaredValue(locale, 'trading.loop.unknown')
  )

  if (retryInMs === undefined) {
    return t(locale, 'trading.loopStopped', { operation })
  }

  return t(locale, 'trading.loopQuarantined', {
    operation,
    minutes: formatCount(locale, Math.round(retryInMs / MS_PER_MINUTE)),
  })
}
