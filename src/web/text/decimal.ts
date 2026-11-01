const SEPARATORS = /[.,]/g
const PLAIN_NUMBER = /^\d+(\.\d+)?$/
const SPACES = /\s+/g
// "1.000" or "12,500": a number with one separator and three digits after it reads as 1 or as 1000.
const GROUPED_NUMBER = /^[1-9]\d{0,2}[.,]\d{3}$/

/** "125,00", "125.00" or "1.250,5": the last separator is the decimal one unless it repeats. Absent
 *  for an empty, negative or non-numeric text; zero is a number. */
export function toDecimal(text: string): number | undefined {
  const cleaned = text.replace(SPACES, '')
  const separators = cleaned.match(SEPARATORS) ?? []
  const last = separators.at(-1)
  const isDecimal = last !== undefined && separators.filter((held) => held === last).length === 1
  const index = isDecimal ? cleaned.lastIndexOf(last) : -1
  const whole = (index < 0 ? cleaned : cleaned.slice(0, index)).replace(SEPARATORS, '')
  const plain = index < 0 ? whole : `${whole}.${cleaned.slice(index + 1)}`

  return PLAIN_NUMBER.test(plain) ? Number(plain) : undefined
}

/** A whole number written with a thousands separator ("1.000"): it reads as 1 as easily as 1000,
 *  so a quantity or price typed so is asked again rather than guessed. */
export function isAmbiguousGrouping(text: string): boolean {
  return GROUPED_NUMBER.test(text.replace(SPACES, ''))
}
