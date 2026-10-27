import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import type { SceneRenderer } from '@/web/scene/renderer'
import type { Point } from '@/web/scene/types'
import { pluralKey } from '@/i18n'
import { digest, resultsLanded } from '@/web/scene/data/board'
import { debateLine, questionLine, roomStatus, toParamText } from '@/web/scene/data/room-status'
import { boardCaptions } from '@/web/scene/sim/board-captions'
import { placeOnPane, view } from '@/web/scene/view'
import { focusRun } from '@/web/state/focus'
import { openIdeas, unseenCalls } from '@/web/state/ideas'
import { type Run, runningCount } from '@/web/state/live'
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
// The new-calls note hangs by its top edge inside the assistant's room, under its tag, over the desk.
const RESULTS_BOARD_AT: Point = Object.freeze({ x: 394, y: 260 })
// The day's note hangs by its top edge under the lobby's lower board, clear of the board's frame
// and the ends of its legs (y 340).
const DIGEST_AT: Point = Object.freeze({ x: 20, y: 344 })
// How long the three rings play after a result lands.
const RINGS_MS = 2_400

/** The boards' one-line buttons. The floor view keeps the results board; the room boards show
 *  once a room is zoomed, and the lobby's day note only in a room's own view. */
export function BoardButtons({ renderer }: { readonly renderer: SceneRenderer }) {
  const shown = view.value
  const isZoomed = shown.room !== undefined || shown.zoomSteps > 0

  if (shown.floor !== 'office') {
    return null
  }

  return (
    <div class="board-buttons">
      <ResultsBoard renderer={renderer} />
      {shown.room !== undefined && <DigestBoard renderer={renderer} />}
      {isZoomed && <RoomBoards renderer={renderer} />}
    </div>
  )
}

function RoomBoards({ renderer }: { readonly renderer: SceneRenderer }) {
  const status = roomStatus.value
  const captions = boardCaptions.value
  const meetRun = status.get('meet')?.runs[0]
  const libRun = status.get('lib')?.runs[0]
  const storeRun = status.get('store')?.runs[0]
  const storeLine = storeBoardLine(storeRun?.progress?.params, status.get('store')?.subject)

  return (
    <>
      <RunBoard
        at={MEET_BOARD_AT}
        renderer={renderer}
        run={debateLine(meetRun) === undefined ? undefined : meetRun}
        line={captions.meet}
      />
      <RunBoard
        at={LIB_BOARD_AT}
        renderer={renderer}
        run={questionLine(libRun) === undefined ? undefined : libRun}
        line={captions.lib}
      />
      {runningCount.value === 0 && captions.lib === undefined && (
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
    </>
  )
}

interface RunBoardProps {
  readonly at: Point
  readonly renderer: SceneRenderer
  readonly run: Run | undefined
  readonly line: string | undefined
}

// A run counting its steps takes you to that run; the day's finished result stands in once it is over.
function RunBoard({ at, renderer, run, line }: RunBoardProps) {
  if (line === undefined) {
    return null
  }

  return run === undefined ? (
    <Board at={at} renderer={renderer}>
      {line}
    </Board>
  ) : (
    <Board at={at} renderer={renderer} onClick={() => focusRun(run.runId)}>
      {line}
    </Board>
  )
}

interface BoardProps {
  readonly at: Point
  readonly renderer: SceneRenderer
  readonly onClick?: () => void
  readonly isOdometer?: boolean
  readonly isRinging?: boolean
  /** A paper note pinned by its top edge, rather than a glass line standing on the point. */
  readonly isNote?: boolean
  readonly children: ComponentChildren
}

// A board with somewhere to go is a button; one that only tells is a note.
function Board({ at, renderer, onClick, isOdometer, isRinging, isNote, children }: BoardProps) {
  const point = placeOnPane(renderer, at)
  const style = { left: `${point.x}px`, top: `${point.y}px` }
  const classes = [
    'board-line',
    isNote === true ? 'board-note' : 'glass',
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

// The buy calls Đề xuất marks as not yet looked at, the same count as its tab; they clear once the
// operator has been there. Three rings play when a result lands while the page is open.
function ResultsBoard({ renderer }: { readonly renderer: SceneRenderer }) {
  const fresh = unseenCalls.value.length
  const isRinging = useRings(resultsLanded.value)

  if (fresh === 0) {
    return null
  }

  return (
    <Board
      at={RESULTS_BOARD_AT}
      renderer={renderer}
      onClick={() => openIdeas('open')}
      isRinging={isRinging}
      isNote
    >
      {tr(pluralKey(fresh, 'ui.office.board.freshOne', 'ui.office.board.fresh'), { count: fresh })}
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
    <Board at={DIGEST_AT} renderer={renderer} onClick={() => openDigest(day)} isNote>
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
