// Line paths from Lucide (ISC; notice in NOTICE.md), drawn at 24 units with the page's stroke.

interface IconProps {
  readonly class?: string
}

const SVG_PROPS = Object.freeze({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const)

export function BellIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

export function CoinIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
      <path d="M12 18V6" />
    </svg>
  )
}

export function CloseIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

export function ChatIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
