type TextPart = { readonly text: string } | { readonly ticker: string }

// Capitals and digits standing alone: a letter either side makes it part of a longer word.
const TICKER_WORD = /(?<![\p{L}\p{N}])[A-Z][A-Z0-9]{1,9}(?![\p{L}\p{N}])/gu

/** Splits one paragraph so each known ticker's first mention is a link; capitals that name no
 *  held, watched or run ticker (VND, ETF, HOSE) stay text. */
export function linkTickers(text: string, known: ReadonlySet<string>): readonly TextPart[] {
  const parts: TextPart[] = []
  const linked = new Set<string>()
  let cursor = 0

  for (const match of text.matchAll(TICKER_WORD)) {
    const [word] = match

    if (!known.has(word) || linked.has(word)) {
      continue
    }

    linked.add(word)
    pushText(parts, text.slice(cursor, match.index))
    parts.push({ ticker: word })
    cursor = match.index + word.length
  }

  pushText(parts, text.slice(cursor))

  return parts
}

function pushText(parts: TextPart[], text: string): void {
  if (text !== '') {
    parts.push({ text })
  }
}
