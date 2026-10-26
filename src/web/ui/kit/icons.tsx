// The office mockup's line icons (Lucide shapes; notice in NOTICE.md), drawn at 24 units with its
// 1.7 stroke. Weather glyphs are Lucide's own, drawn the same way.

interface IconProps {
  readonly class?: string
}

const SVG_PROPS = Object.freeze({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.7,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const)

function classOf(className: string | undefined): string {
  return className === undefined ? 'icon' : `icon ${className}`
}

export function BellIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21h4" />
    </svg>
  )
}

// The scene's master light switch.
export function LampIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
    </svg>
  )
}

export function CoinIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9 9.5h4.5a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3H15" />
    </svg>
  )
}

export function CloseIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

export function ChatIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </svg>
  )
}

export function MoreIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  )
}

export function CheckIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function ChevronLeftIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

// Folds the info panel to its rail; the rail draws it turned around to open the panel again.
export function CollapseIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="m13 17 5-5-5-5M6 17l5-5-5-5" />
    </svg>
  )
}

export function FocusIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  )
}

export function ListIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  )
}

export function PieIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M21 12A9 9 0 1 1 12 3v9z" />
      <path d="M12 3a9 9 0 0 1 9 9h-9z" />
    </svg>
  )
}

export function TrendIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M3 3v18h18" />
      <path d="m7 15 4-4 3 3 5-6" />
    </svg>
  )
}

export function GlobeIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  )
}

export function CalendarIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  )
}

export function NewsIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M4 5h13v14H6a2 2 0 0 1-2-2z" />
      <path d="M17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5" />
    </svg>
  )
}

export function ClockIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function BulbIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z" />
    </svg>
  )
}

// The mockup's own gear, drawn on a 16-unit grid with a finer ring and heavier teeth.
export function GearIcon({ class: className }: IconProps) {
  return (
    <svg
      class={classOf(className)}
      aria-hidden="true"
      {...SVG_PROPS}
      viewBox="0 0 16 16"
      stroke-width={1.4}
    >
      <circle cx="8" cy="8" r="4.2" />
      <circle cx="8" cy="8" r="1.6" />
      <path
        d="M8 1.5v2.3M8 12.2v2.3M1.5 8h2.3M12.2 8h2.3M3.4 3.4l1.6 1.6M11 11l1.6 1.6M12.6 3.4L11 5M5 11l-1.6 1.6"
        stroke-width={2}
      />
    </svg>
  )
}

export function SunIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

export function CloudIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  )
}

export function RainIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M16 14v6M8 14v6M12 16v6" />
    </svg>
  )
}

export function StormIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" />
      <path d="m13 12-3 5h4l-3 5" />
    </svg>
  )
}

export function FogIcon({ class: className }: IconProps) {
  return (
    <svg class={classOf(className)} aria-hidden="true" {...SVG_PROPS}>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M16 17H7M17 21H9" />
    </svg>
  )
}
