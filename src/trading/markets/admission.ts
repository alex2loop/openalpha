import type { CaveatCode, HoldReasonCode } from '@/trading/kernel/caveat'
import type { ScreenGateCode } from '@/trading/kernel/screen-codes'

/** What a market does about its own failed admission gates on the suggestion path. A gate in
 *  neither table is deliberately silent — `ceiling-locked` is already the levels block, and a gate
 *  the market only ranks on has no verdict to add. A market declaring no policy admits every named
 *  ticker, which is the right answer only where its `candidacy` is already a closed list. */
export interface AdmissionPolicy {
  /** Gates that make the trade impossible or the arithmetic unreliable. */
  readonly blocking: Readonly<Partial<Record<ScreenGateCode, HoldReasonCode>>>
  /** Gates that cost a conviction band rather than the answer. */
  readonly lowering: Readonly<Partial<Record<ScreenGateCode, CaveatCode>>>
}
