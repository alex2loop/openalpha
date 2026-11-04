import type { MessageKey } from '@/i18n'
import { isAnalysisOnly } from '@/web/state/edition'
import { tr } from '@/web/text/tr'

// The caveats that name a regime or a defensive stance, or rank or rate, which the web edition
// never states: they read in the web's own wording.
const WEB_CAVEAT_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
  'macro.inputs-missing': 'ui.office.edition.macroCaveat.inputsMissing',
  'macro.regime-lowered': 'ui.office.edition.macroCaveat.regimeLowered',
  'macro.regime-held': 'ui.office.edition.macroCaveat.regimeHeld',
  'macro.confirmers-abstained': 'ui.office.edition.macroCaveat.confirmersAbstained',
  'macro.coverage-at-floor': 'ui.office.edition.macroCaveat.coverageAtFloor',
  'macro.coverage-below-floor': 'ui.office.edition.macroCaveat.coverageBelowFloor',
  'market-data.evidence-settled-only': 'trading.caveat.market-data.evidence-settled-onlyPlain',
  'market-data.series-stale': 'trading.caveat.market-data.series-stalePlain',
  'market-data.screen-unsupported': 'trading.caveat.market-data.screen-unsupportedPlain',
  'market-data.sectors-unsupported': 'trading.caveat.market-data.sectors-unsupportedPlain',
  'factor.coverage-below-minimum': 'trading.caveat.factor.coverage-below-minimumPlain',
})

interface CaveatLike {
  readonly code?: string | undefined
  readonly data?: Readonly<Record<string, string | number>> | undefined
  readonly text: string
}

/** What a caveat says: the daemon's own sentence, except on the web edition, where one naming a
 *  regime or a stance, or ranking or rating, reads in the web's neutral wording. */
export function toCaveatText(caveat: CaveatLike): string {
  const key =
    isAnalysisOnly.value && caveat.code !== undefined ? WEB_CAVEAT_KEYS[caveat.code] : undefined

  return key === undefined ? caveat.text : tr(key, caveat.data)
}
