import type { Locale } from '@/core/types/locale'
import type { CapBreach } from '@/trading/kernel/operator/exposure'
import { t } from '@/i18n'
import { formatFraction, formatWholeFraction, renderDeclaredValue } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'

/** One sentence per breach, whichever surface asked. A fold over weights takes the whole-percent
 *  form: the second decimal claims resolution the fold never had. */
export function renderCapBreachLines(
  locale: Locale,
  breaches: readonly CapBreach[]
): readonly string[] {
  return breaches.map((breach) => `${INDENT[1]}${renderCapBreach(locale, breach)}`)
}

export function renderCapBreach(locale: Locale, breach: CapBreach): string {
  if (breach.kind === 'etf-unmeasured') {
    return t(locale, 'trading.render.exposure.etfUnmeasured', {
      segment: renderDeclaredValue(locale, `trading.segment.${breach.segment}`),
      cap: formatWholeFraction(locale, breach.capPctNav),
    })
  }

  // A zero ceiling is the profile closing the bucket, so "past the 0% cap" would misstate it.
  if (breach.capPctNav === 0 && (breach.kind === 'segment' || breach.kind === 'etf')) {
    return t(
      locale,
      breach.kind === 'etf'
        ? 'trading.render.exposure.etfClosed'
        : 'trading.render.exposure.segmentClosed',
      { segment: renderDeclaredValue(locale, `trading.segment.${breach.segment}`) }
    )
  }

  // Whole percents that read equal would state no breach, so the decimals earn their place.
  const equalWhole =
    formatWholeFraction(locale, breach.combinedPctNav) ===
    formatWholeFraction(locale, breach.capPctNav)
  const format = equalWhole ? formatFraction : formatWholeFraction

  return t(locale, 'trading.render.exposure.breach', {
    subject: subjectOf(locale, breach),
    combined: format(locale, breach.combinedPctNav),
    cap: format(locale, breach.capPctNav),
  })
}

function subjectOf(locale: Locale, breach: Exclude<CapBreach, { kind: 'etf-unmeasured' }>): string {
  switch (breach.kind) {
    case 'position':
      return breach.ticker
    case 'sector':
      return breach.sector
    case 'segment':
      return renderDeclaredValue(locale, `trading.segment.${breach.segment}`)
    case 'etf':
      return t(locale, 'trading.render.exposure.etfSubject', {
        segment: renderDeclaredValue(locale, `trading.segment.${breach.segment}`),
      })
    default: {
      const exhaustive: never = breach
      return exhaustive
    }
  }
}
