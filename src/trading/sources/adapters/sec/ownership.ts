import type { InsiderRelationship } from '@/trading/kernel/market/market-event'

/** A Form 4's transactions we read: one non-derivative line of an ownership document. */
interface OwnershipTransaction {
  readonly code: string
  readonly day: string
  readonly shares: number
  /** Absent when the document states the price only in a footnote. */
  readonly price?: number
}

export interface OwnershipFiling {
  readonly owner: string
  readonly officerTitle?: string
  /** Only when the filing names no officer title. */
  readonly relationship?: InsiderRelationship
  readonly transactions: readonly OwnershipTransaction[]
}

const OWNER_RE = /<rptOwnerName>\s*([^<]*?)\s*</
const TITLE_RE = /<officerTitle>\s*([^<]*?)\s*</
const DIRECTOR_RE = /<isDirector>\s*(?:true|1)\s*</
const TEN_PERCENT_RE = /<isTenPercentOwner>\s*(?:true|1)\s*</
const TRANSACTION_RE = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g
const DAY_RE = /<transactionDate>\s*<value>\s*([^<]+?)\s*</
const CODE_RE = /<transactionCode>\s*([^<]+?)\s*</
const SHARES_RE = /<transactionShares>\s*<value>\s*([^<]+?)\s*</
const PRICE_RE = /<transactionPricePerShare>\s*<value>\s*([^<]+?)\s*</

/** Regular enough to read with patterns, as the Treasury's XML is. A line that cannot be read is
 *  left out, never filled in; a document with no owner is not an ownership document. */
export function parseOwnershipXml(text: string): OwnershipFiling | undefined {
  const owner = OWNER_RE.exec(text)?.[1]

  if (owner === undefined || owner === '') {
    return undefined
  }

  const title = TITLE_RE.exec(text)?.[1]
  const officerTitle = title === '' ? undefined : title
  const relationship = officerTitle === undefined ? relationshipOf(text) : undefined

  return {
    owner,
    ...(officerTitle === undefined ? {} : { officerTitle }),
    ...(relationship === undefined ? {} : { relationship }),
    transactions: [...text.matchAll(TRANSACTION_RE)].flatMap((match) =>
      toTransaction(match[1] ?? '')
    ),
  }
}

function relationshipOf(text: string): InsiderRelationship | undefined {
  if (DIRECTOR_RE.test(text)) {
    return 'director'
  }

  return TEN_PERCENT_RE.test(text) ? 'ten-percent-owner' : undefined
}

function toTransaction(block: string): OwnershipTransaction[] {
  const day = DAY_RE.exec(block)?.[1]
  const code = CODE_RE.exec(block)?.[1]
  const shares = Number(SHARES_RE.exec(block)?.[1])
  const price = Number(PRICE_RE.exec(block)?.[1])

  if (day === undefined || code === undefined || !Number.isFinite(shares) || shares <= 0) {
    return []
  }

  return [{ code, day, shares, ...(Number.isFinite(price) && price > 0 ? { price } : {}) }]
}
