import { termOfMarket } from '@/i18n'
import { Term } from '@/web/ui/glossary/term'

/** A market's name, explained when the glossary has it as a term (world gold). */
export function MarketName({
  market,
  label,
}: {
  readonly market: string
  readonly label: string | undefined
}) {
  const name = label ?? market
  const term = termOfMarket(market)

  return term === undefined ? name : <Term id={term}>{name}</Term>
}
