/** What night mixes every daylight tone toward. */
export const NIGHT_TONE = '#0A0E1C'
// Darker than this, the street's night lights are on.
const NIGHT_MIN_DARK = 0.3

/** Night-tinted sprites are cached at this many steps of darkness, never per minute. */
export const DARK_STEPS = 6
const HEX_RADIX = 16
const CHANNEL_BITS = 8
const CHANNEL_MASK = 0xff
const CHANNEL_DIGITS = 2
const CHANNELS = [2, 1, 0] as const

/** The sky is dark enough for the street's night lights. */
export function isNightDark(dark: number): boolean {
  return dark > NIGHT_MIN_DARK
}

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
