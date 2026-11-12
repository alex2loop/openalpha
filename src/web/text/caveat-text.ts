import { isAnalysisOnly } from '@/web/state/edition'

/** The caveat a record carries while calls it holds are still inside their outcome window. */
export const AWAITING_WINDOW_CODE = 'reporting.awaiting-window'

interface CaveatLike {
  readonly text: string
  readonly plain?: string | undefined
}

/** What a caveat says: the daemon's own sentence, except on the web edition, where the one it words
 *  with no ranking, rating or advice stands in for one that has it. */
export function toCaveatText({ text, plain }: CaveatLike): string {
  return isAnalysisOnly.value ? (plain ?? text) : text
}
