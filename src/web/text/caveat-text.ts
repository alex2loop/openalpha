import { isAnalysisOnly } from '@/web/state/edition'

interface CaveatLike {
  readonly text: string
  readonly plain?: string | undefined
}

/** What a caveat says: the daemon's own sentence, except on the web edition, where the one it words
 *  with no ranking, rating or advice stands in for one that has it. */
export function toCaveatText({ text, plain }: CaveatLike): string {
  return isAnalysisOnly.value ? (plain ?? text) : text
}
