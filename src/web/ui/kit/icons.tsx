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

// The office mockup's own lamp, for the scene's master light switch.
export function LampIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
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

export function MoreIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  )
}

export function CheckIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function ChevronLeftIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

export function PanelIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </svg>
  )
}

export function FocusIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

export function ListIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  )
}

export function PieIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  )
}

export function TrendIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
      <path d="M16 7h6v6" />
    </svg>
  )
}

export function GlobeIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  )
}

export function CalendarIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  )
}

export function NewsIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8" />
      <path d="M15 18h-5" />
      <path d="M10 6h8v4h-8V6Z" />
    </svg>
  )
}

export function ClockIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  )
}

export function BulbIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  )
}

export function GearIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function SunIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

export function CloudIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  )
}

export function RainIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M16 14v6M8 14v6M12 16v6" />
    </svg>
  )
}

export function StormIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" />
      <path d="m13 12-3 5h4l-3 5" />
    </svg>
  )
}

export function FogIcon({ class: className }: IconProps) {
  return (
    <svg class={className} aria-hidden="true" {...SVG_PROPS}>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M16 17H7M17 21H9" />
    </svg>
  )
}
