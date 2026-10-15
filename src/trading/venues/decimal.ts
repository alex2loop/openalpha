const MAXIMUM_WIRE_DECIMALS = 8
const TRAILING_ZEROS_RE = /\.?0+$/

/** A plain decimal: a venue rejects exponent notation, which `String(1e-7)` produces. */
export function toDecimalString(value: number): string {
  return value.toFixed(MAXIMUM_WIRE_DECIMALS).replace(TRAILING_ZEROS_RE, '')
}
