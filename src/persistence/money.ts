import { ValidationError } from '@/core/errors'

// USD costs are stored as integer nano-USD so ledger addition and SUM() are exact on both dialects
// (sqlite has no DECIMAL; pg numeric round-trips as a string). Dollars stay dollars everywhere
// outside persistence/. `toNanoUsd` guards each row at +/- MAX_SAFE_INTEGER nano-USD, about $9.0M;
// an aggregate past that loses exactness as a JS number, bounded by float spacing to nanodollars at
// $9M and under a cent at $90M, so it moves no displayed figure and refusing it would be worse.
const NANO_PER_USD = 1_000_000_000

export function toNanoUsd(usd: number): number {
  const nano = Math.round(usd * NANO_PER_USD)

  // A NaN or Infinity cost silently poisons every later SUM over the ledger.
  if (!Number.isSafeInteger(nano)) {
    throw new ValidationError(`cost out of range: ${usd} USD`)
  }

  return nano
}

export function fromNanoUsd(nano: number): number {
  return nano / NANO_PER_USD
}
