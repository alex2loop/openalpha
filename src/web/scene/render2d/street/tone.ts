const HEX_RADIX = 16
const CHANNEL_BITS = 8
const CHANNEL_MASK = 0xff
const CHANNEL_DIGITS = 2
const CHANNELS = [2, 1, 0] as const

/** `hex` (`#RRGGBB`) moved `share` (0 to 1) of the way to `toward`, as `#RRGGBB`. */
export function mixTone(hex: string, toward: string, share: number): string {
  const from = Number.parseInt(hex.slice(1), HEX_RADIX)
  const to = Number.parseInt(toward.slice(1), HEX_RADIX)
  const k = Math.min(1, Math.max(0, share))
  const digits = CHANNELS.map((channel) => {
    const a = (from >> (channel * CHANNEL_BITS)) & CHANNEL_MASK
    const b = (to >> (channel * CHANNEL_BITS)) & CHANNEL_MASK

    return Math.round(a + (b - a) * k)
      .toString(HEX_RADIX)
      .padStart(CHANNEL_DIGITS, '0')
  })

  return `#${digits.join('')}`
}
