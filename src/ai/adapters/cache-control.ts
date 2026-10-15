export const EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' } as const

type WireBlock = Record<string, unknown>

/** A system text as two wire blocks, the reusable prefix closed by a cache breakpoint, or undefined
 *  when the prefix length does not fall strictly inside the text. */
export function toCachedTextBlocks(
  text: string,
  cachePrefixLength?: number
): readonly WireBlock[] | undefined {
  if (
    cachePrefixLength === undefined ||
    !Number.isInteger(cachePrefixLength) ||
    cachePrefixLength <= 0 ||
    cachePrefixLength >= text.length
  ) {
    return undefined
  }

  return [
    {
      type: 'text',
      text: text.slice(0, cachePrefixLength),
      cache_control: EPHEMERAL_CACHE_CONTROL,
    },
    { type: 'text', text: text.slice(cachePrefixLength) },
  ]
}
