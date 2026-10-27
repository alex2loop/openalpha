import type { LitScreen } from '@/web/scene/overlay/screens'
import type { ScreenLine } from '@/web/scene/overlay-types'
import type { ActorId, Rect } from '@/web/scene/types'
import { boxStyle } from '@/web/scene/overlay/box-style'
import {
  barRowOf,
  barWidthOf,
  shownLinesOf,
  type TerminalLayout,
  terminalLayoutOf,
} from '@/web/scene/overlay/screen-layout'
import { typedChars } from '@/web/scene/overlay/screen-typing'
import { reducedMotion } from '@/web/state/prefs'
import { tr } from '@/web/text/tr'

// The price line's drawing box; the svg stretches it over the screen.
const LINE_BOX_W = 100
const LINE_BOX_H = 40
// The text cursor's block, in ems of the font.
const CURSOR_W_EM = 0.45
const CURSOR_H_EM = 0.9
// The title bar's three dots, left to right; each is a pixel of the screen, two apart.
const DOTS = ['red', 'amber', 'teal'] as const
const DOT_PX = 1
const DOT_STEP_PX = 2

// The terminal text's filter, shared through the css: every antialiased pixel at least this
// opaque becomes ink, as the mockup's monitor text does.
const CRISP_ALPHA_MIN = 100
const ALPHA_STEPS = 255

/** The filter the terminals' text runs through to land on solid pixels; it takes no room. */
export function CrispFilter() {
  return (
    <svg class="desk-crisp" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id="desk-crisp">
        <feComponentTransfer>
          <feFuncA type="linear" slope={ALPHA_STEPS} intercept={1 - CRISP_ALPHA_MIN} />
        </feComponentTransfer>
      </filter>
    </svg>
  )
}

/** A lit screen over its computer: the analyst's price line, or a terminal that types the run's
 *  lines (a scout's reading its page's host). */
export function DeskScreen({ screen, rect }: { readonly screen: LitScreen; readonly rect: Rect }) {
  const { content } = screen

  if (content.kind === 'line') {
    return (
      <span class="desk-screen" style={boxStyle(rect)} title={content.ticker}>
        <svg
          viewBox={`0 0 ${LINE_BOX_W} ${LINE_BOX_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline points={toPoints(content.closes)} />
        </svg>
      </span>
    )
  }

  const title =
    content.kind === 'host' ? tr('ui.office.screen.reading', { host: content.host }) : content.title

  return <Terminal lines={content.lines} actor={screen.actor} rect={rect} title={title} />
}

function Terminal(props: {
  readonly lines: readonly ScreenLine[]
  readonly actor: ActorId
  readonly rect: Rect
  readonly title: string
}) {
  const { lines, rect } = props
  const layout = terminalLayoutOf(rect)
  const chars = typedChars.value.get(props.actor) ?? lines.at(-1)?.text.length ?? 0
  const shown = shownLinesOf(lines, chars, layout.rows)
  const isBlinking = !reducedMotion.value

  return (
    <span
      class={reducedMotion.value ? 'desk-screen is-terminal is-still' : 'desk-screen is-terminal'}
      style={{ ...boxStyle(rect), ...fontOf(layout) }}
      title={props.title}
    >
      {layout.kind === 'text' ? (
        <TextRows layout={layout} shown={shown} isBlinking={isBlinking} />
      ) : (
        <BarRows layout={layout} shown={shown} isBlinking={isBlinking} />
      )}
    </span>
  )
}

interface RowsProps<T extends TerminalLayout> {
  readonly layout: T
  readonly shown: readonly ScreenLine[]
  readonly isBlinking: boolean
}

function TextRows({
  layout,
  shown,
  isBlinking,
}: RowsProps<Extract<TerminalLayout, { kind: 'text' }>>) {
  const { fs, top, pad } = layout
  const dot = Math.max(1, Math.round(top / 3))

  return (
    <>
      <span
        class="desk-titlebar"
        style={{ height: `${top}px`, paddingLeft: `${pad}px`, gap: `${dot}px` }}
      >
        {DOTS.map((tone) => (
          <i
            key={tone}
            class={`desk-dot is-${tone}`}
            style={{ width: `${dot}px`, height: `${dot}px` }}
          />
        ))}
      </span>
      <span class="desk-rows" style={{ padding: `${pad}px ${pad}px 0` }}>
        {shown.map((line, i) => (
          <span key={line.id} class={`desk-row is-${line.kind}`}>
            {line.text}
            {isBlinking && i === shown.length - 1 && (
              <i
                class="desk-cursor"
                style={{ width: `${fs * CURSOR_W_EM}px`, height: `${fs * CURSOR_H_EM}px` }}
              />
            )}
          </span>
        ))}
      </span>
    </>
  )
}

function BarRows({
  layout,
  shown,
  isBlinking,
}: RowsProps<Extract<TerminalLayout, { kind: 'bars' }>>) {
  const { unit, cols } = layout
  const pixel = (x: number, y: number, w = DOT_PX) => ({
    left: `${x * unit}px`,
    top: `${y * unit}px`,
    width: `${w * unit}px`,
    height: `${unit}px`,
  })

  return (
    <>
      <span class="desk-titlebar is-bars" style={pixel(0, 0, cols)}>
        {DOTS.map((tone, i) => (
          <i key={tone} class={`desk-dot is-${tone}`} style={pixel(DOT_PX + i * DOT_STEP_PX, 0)} />
        ))}
      </span>
      {shown.map((line, i) => {
        const width = barWidthOf(line.text, cols)

        return (
          <span key={line.id} aria-hidden="true">
            <i class={`desk-bar is-${line.kind}`} style={pixel(1, barRowOf(i), width)} />
            {isBlinking && i === shown.length - 1 && (
              <i class="desk-cursor" style={pixel(1 + width, barRowOf(i))} />
            )}
          </span>
        )
      })}
    </>
  )
}

// A text terminal's font; bars set none.
function fontOf(layout: TerminalLayout): Record<string, string> {
  return layout.kind === 'text' ? { fontSize: `${layout.fs}px`, lineHeight: `${layout.lh}px` } : {}
}

// The closes scaled into the line's box, the lowest at the bottom.
function toPoints(closes: readonly number[]): string {
  const low = Math.min(...closes)
  const span = Math.max(...closes) - low || 1
  const stepX = LINE_BOX_W / Math.max(1, closes.length - 1)

  return closes
    .map((close, index) => `${index * stepX},${LINE_BOX_H - ((close - low) / span) * LINE_BOX_H}`)
    .join(' ')
}
