import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import type { SceneRenderer } from '@/web/scene/renderer'
import type { Point } from '@/web/scene/types'
import { pluralKey } from '@/i18n'
import { digest, resultsLanded, todayCalls } from '@/web/scene/data/board'
import { debateLine, roomStatus, toParamText } from '@/web/scene/data/room-status'
import { projection, view } from '@/web/scene/view'
import { focusRun } from '@/web/state/focus'
import { runningCount } from '@/web/state/live'
import { reducedMotion } from '@/web/state/prefs'
import { formatUsd } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { openModal } from '@/web/ui/kit/modal'

import './board-buttons.css'

// Where each board's line sits on the floor: just above the board it belongs to.
const MEET_BOARD_AT: Point = Object.freeze({ x: 398, y: 40 })
const LIB_BOARD_AT: Point = Object.freeze({ x: 328, y: 40 })
const STORE_BOARD_AT: Point = Object.freeze({ x: 44, y: 30 })
const RESULTS_BOARD_AT: Point = Object.freeze({ x: 414, y: 256 })
const DIGEST_AT: Point = Object.freeze({ x: 20, y: 330 })
// How long the three rings play after a result lands.
const RINGS_MS = 2_400

/** The boards' one-line buttons. The floor view keeps only the results board; the room boards and
 *  the lobby digest show once a room is zoomed. */
export function BoardButtons({ renderer }: { readonly renderer: SceneRenderer }) {
  const shown = view.value
  const isZoomed = shown.room !== undefined || shown.zoomSteps > 0

  // Read so the boards follow the camera.
  projection.value

  if (shown.floor !== 'office') {
    return null
  }

  return (
    <div class="board-buttons">
      <ResultsBoard renderer={renderer} />
      {isZoomed && <RoomBoards renderer={renderer} />}
    </div>
  )
}

function RoomBoards({ renderer }: { readonly renderer: SceneRenderer }) {
  const status = roomStatus.value
  const meetRun = status.get('meet')?.runs[0]
  const libRun = status.get('lib')?.runs[0]
  const storeRun = status.get('store')?.runs[0]
  const meetLine = debateLine(meetRun)
  const libLine = questionLine(libRun?.progress?.params)
  const storeLine = storeBoardLine(storeRun?.progress?.params, status.get('store')?.subject)

  return (
    <>
      {meetRun !== undefined && meetLine !== undefined && (
        <Board at={MEET_BOARD_AT} renderer={renderer} onClick={() => focusRun(meetRun.runId)}>
          {meetLine}
        </Board>
      )}
      {libRun !== undefined && libLine !== undefined && (
        <Board at={LIB_BOARD_AT} renderer={renderer} onClick={() => focusRun(libRun.runId)}>
          {libLine}
        </Board>
      )}
      {runningCount.value === 0 && (
        <Board at={LIB_BOARD_AT} renderer={renderer}>
          {tr('ui.office.board.firstCommand')}
        </Board>
      )}
      {storeRun !== undefined && storeLine !== undefined && (
        <Board
          at={STORE_BOARD_AT}
          renderer={renderer}
          onClick={() => focusRun(storeRun.runId)}
          isOdometer
        >
          {storeLine}
        </Board>
      )}
      <DigestBoard renderer={renderer} />
    </>
  )
}

interface BoardProps {
  readonly at: Point
  readonly renderer: SceneRenderer
  readonly onClick?: () => void
  readonly isOdometer?: boolean
  readonly isRinging?: boolean
  readonly children: ComponentChildren
}

// A board with somewhere to go is a button; one that only tells is a note.
function Board({ at, renderer, onClick, isOdometer, isRinging, children }: BoardProps) {
  const point = renderer.toScreen(at)
  const style = { left: `${point.x}px`, top: `${point.y}px` }
  const classes = [
    'board-line',
    'glass',
    isOdometer === true ? 'board-odometer' : '',
    isRinging === true ? 'board-rings' : '',
  ]
    .filter((name) => name !== '')
    .join(' ')

  return onClick === undefined ? (
    <span class={classes} style={style}>
      {children}
    </span>
  ) : (
    <button type="button" class={classes} style={style} onClick={onClick}>
      {children}
    </button>
  )
}

// Today's new calls; three rings play when a result lands while the page is open.
function ResultsBoard({ renderer }: { readonly renderer: SceneRenderer }) {
  const calls = todayCalls.value
  const fresh = calls?.filter((call) => call.action !== 'hold').length ?? 0
  const isRinging = useRings(resultsLanded.value)

  if (calls === undefined || fresh === 0) {
    return null
  }

  return (
    <Board at={RESULTS_BOARD_AT} renderer={renderer} isRinging={isRinging}>
      {tr(pluralKey(fresh, 'ui.office.board.freshOne', 'ui.office.board.fresh'), { count: fresh })}
      <span class="board-all">
        {tr(pluralKey(calls.length, 'ui.office.board.allOne', 'ui.office.board.all'), {
          count: calls.length,
        })}
      </span>
    </Board>
  )
}

// The timer belongs to the board and ends with it; reduced motion plays no rings.
function useRings(landed: number): boolean {
  const [isRinging, setRinging] = useState(false)

  useEffect(() => {
    if (landed === 0 || reducedMotion.value) {
      return undefined
    }

    setRinging(true)

    const timer = setTimeout(() => setRinging(false), RINGS_MS)

    return () => clearTimeout(timer)
  }, [landed])

  return isRinging
}

function DigestBoard({ renderer }: { readonly renderer: SceneRenderer }) {
  const held = digest.value

  if (held === undefined) {
    return null
  }

  const day = held.isToday ? tr('ui.office.common.today') : tr('ui.office.board.digestYesterday')
  const line = tr('ui.office.board.digest', {
    day,
    ideas: held.wire.suggestions,
    reports: held.wire.reports,
  })

  return (
    <Board at={DIGEST_AT} renderer={renderer} onClick={() => openDigest(day)}>
      {line}
    </Board>
  )
}

function openDigest(day: string): void {
  const held = digest.value

  if (held === undefined) {
    return
  }

  const handle = openModal({
    title: tr('ui.office.board.digestTitle', { day }),
    body: (
      <div class="digest-body">
        <p>
          {tr('ui.office.board.digest', {
            day,
            ideas: held.wire.suggestions,
            reports: held.wire.reports,
          })}
        </p>
        <p class="meta">
          {tr('ui.office.board.digestSpend', { cost: formatUsd(held.wire.spendUsd) })}
        </p>
        {held.wire.notable.map((note) => (
          <p key={`${note.kind}:${note.ticker}:${note.at}`}>{note.text}</p>
        ))}
      </div>
    ),
    footer: (
      <Button kind="commit" onClick={() => handle.close()}>
        {tr('ui.office.common.close')}
      </Button>
    ),
  })
}

function questionLine(params: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const n = toParamText(params?.index ?? params?.done)
  const total = toParamText(params?.total)

  return n === undefined || total === undefined
    ? undefined
    : tr('ui.office.board.lib', { n, total })
}

function storeBoardLine(
  params: Readonly<Record<string, unknown>> | undefined,
  market: string | undefined
): string | undefined {
  const done = toParamText(params?.done)
  const total = toParamText(params?.total)

  if (market === undefined || done === undefined || total === undefined) {
    return undefined
  }

  return tr('ui.office.board.store', { market, done, total })
}
