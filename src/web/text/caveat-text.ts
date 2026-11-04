import type { MessageKey } from '@/i18n'
import { isAnalysisOnly } from '@/web/state/edition'
import { tr } from '@/web/text/tr'

// The macro caveats that name a regime or a defensive stance, which the web edition never states.
const WEB_CAVEAT_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
  'macro.inputs-missing': 'ui.office.edition.macroCaveat.inputsMissing',
  'macro.regime-lowered': 'ui.office.edition.macroCaveat.regimeLowered',
  'macro.regime-held': 'ui.office.edition.macroCaveat.regimeHeld',
  'macro.confirmers-abstained': 'ui.office.edition.macroCaveat.confirmersAbstained',
  'macro.coverage-at-floor': 'ui.office.edition.macroCaveat.coverageAtFloor',
  'macro.coverage-below-floor': 'ui.office.edition.macroCaveat.coverageBelowFloor',
})

interface CaveatLike {
  readonly code?: string | undefined
  readonly text: string
}

/** What a caveat says: the daemon's own sentence, except on the web edition, where one naming a
 *  regime or a stance reads in the web's neutral wording. */
export function toCaveatText(caveat: CaveatLike): string {
  const key =
    isAnalysisOnly.value && caveat.code !== undefined ? WEB_CAVEAT_KEYS[caveat.code] : undefined

  return key === undefined ? caveat.text : tr(key)
}
