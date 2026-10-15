import type { Locale } from '@/core/types/locale'
import type { SleeveBreach } from '@/trading/kernel/operator/exposure'
import { t } from '@/i18n'
import { formatWholeFraction, renderDeclaredValue } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'

/** One sentence per breach, whichever surface asked. A fold over weights takes the whole-percent
 *  form: the second decimal claims resolution the fold never had. */
export function renderSleeveBreachLines(
  locale: Locale,
  breaches: readonly SleeveBreach[]
): readonly string[] {
  return breaches.map((breach) => `${INDENT[1]}${renderBreach(locale, breach)}`)
}

function renderBreach(locale: Locale, breach: SleeveBreach): string {
  if (breach.kind === 'etf-unmeasured') {
    return t(locale, 'trading.render.exposure.etfUnmeasured', {
      segment: renderDeclaredValue(locale, `trading.segment.${breach.segment}`),
      cap: formatWholeFraction(locale, breach.capPctNav),
    })
  }

  return t(locale, 'trading.render.exposure.breach', {
    subject: subjectOf(locale, breach),
    combined: formatWholeFraction(locale, breach.combinedPctNav),
    cap: formatWholeFraction(locale, breach.capPctNav),
  })
}

function subjectOf(
  locale: Locale,
  breach: Exclude<SleeveBreach, { kind: 'etf-unmeasured' }>
): string {
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
