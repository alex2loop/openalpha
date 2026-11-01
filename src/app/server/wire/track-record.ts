// Shapes the /v1/track-record summary carries that `wire/trading.ts` has no room for.

/** One model and how the calls it argued alone resolved. A call argued by several models is in
 *  none of these rows. `winRate` is absent below the reporting minimum, like every rate. */
export interface ByModelWire {
  readonly model: string
  readonly resolvedCount: number
  readonly winCount: number
  readonly winRate?: number
}
