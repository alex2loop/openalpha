import type {
  BookExposure,
  HeldPosition,
  RoundTripHistory,
  SleeveExposure,
} from '@/trading/features/suggestion/exposure'
import { promptPercent } from '@/trading/prompt-text'

/** What the book holds of this name and of the sleeves it belongs to, against the caps the sizer
 *  will enforce anyway. Weights only: a role reasoning about concentration needs the share, and the
 *  absolute size of the account is not its business. */
export function portfolioSection(exposure: BookExposure | undefined): string {
  if (exposure === undefined) {
    return ''
  }

  return [
    "PORTFOLIO (already held, as a share of the book; quantity is the sizer's, not yours):",
    ...heldRows(exposure.held),
    ...roundTripRows(exposure.roundTrips),
    ...(exposure.sector === undefined ? [] : [sleeveRow('sector', exposure.sector)]),
    'These caps are enforced deterministically after this step, so a sleeve under its cap is never',
    'a reason to hold the idea; one at or near its cap is a reason for caution in your rationale.',
  ].join('\n')
}

/** The section reasons in weights, so a holding the book could not weigh says it is held and stops
 *  there rather than reporting a share it does not have. */
function heldRows(held: HeldPosition | undefined): readonly string[] {
  if (held === undefined) {
    return ['- this name: not held']
  }

  const weight =
    held.pctNav === undefined ? 'held, share of book unknown' : `${promptPercent(held.pctNav)} held`

  return [`- this name: ${weight}${builtOver(held)}`]
}

/** Silent on a first entry, because "built over 1 buy" is not a fact worth a clause. Beyond one, it
 *  is what separates arguing an entry from arguing another tranche of a position already open. */
function builtOver(held: HeldPosition): string {
  if (held.openLotCount <= 1 || held.firstAcquiredAt === undefined) {
    return ''
  }

  return `, built over ${held.openLotCount} buys since ${held.firstAcquiredAt}`
}

/** What the operator already did with this name, which the held row cannot say once the position is
 *  closed: "not held" reads as never owned, and a name sold yesterday is a different argument. */
function roundTripRows(history: RoundTripHistory | undefined): readonly string[] {
  if (history === undefined) {
    return []
  }

  return [
    `- your own history: closed ${history.count} time(s) recently, last on ${history.lastClosedAt} at a ${history.lastResult}`,
  ]
}

function sleeveRow(label: string, sleeve: SleeveExposure): string {
  return `- ${label} ${sleeve.name}: ${promptPercent(sleeve.pctNav)} held, cap ${promptPercent(sleeve.capPctNav)}`
}
