import type { Writer } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import { isInteractiveStdout, isUnicode } from '@/cli/env'
import { currentTerminal } from '@/cli/terminal'
import { ASCII_FRAMES, SPINNER_INTERVAL_MS, UNICODE_FRAMES } from '@/cli/ui/spinner'
import { formatDuration } from '@/core/utils/duration'
import { pluralKey, t } from '@/i18n'

export const STATUS_KEY = 'status'
const QUESTION_PREFIX = 'q:'
const FRAME_BLANK = '  '
const FALLBACK_COLUMNS = 80

export function questionKey(questionId: string): string {
  return `${QUESTION_PREFIX}${questionId}`
}

export interface ResearchProgressOutput {
  readonly writeRaw: Writer
  readonly writeLine: Writer
}

export interface ActivityDisplay {
  set(key: string, label: string): void
  remove(key: string): void
  clearKeyed(): void
  printPersistent(line: string): void
  pause(): void
  resume(): void
  close(): void
}

interface Activity {
  readonly label: string
  readonly startedAt: number
}

interface ActivityStore {
  set(key: string, label: string): void
  remove(key: string): void
  clearKeyed(): void
}

interface StatusStats {
  readonly crawlActive: boolean
  readonly questionTotal: number
  readonly terminalQuestionCount: number
  readonly searchCount: number
  readonly fetchCount: number
  readonly showCancelHint: boolean
}

interface OrderedLinesInput {
  readonly activities: ReadonlyMap<string, Activity>
  readonly locale: Locale
  readonly now: number
  readonly stats: StatusStats
}

interface OrderedLine {
  readonly text: string
  readonly spin: boolean
}

interface StatusLineInput {
  readonly status: Activity
  readonly stats: StatusStats
  readonly locale: Locale
  readonly now: number
}

interface FrameState {
  readonly frames: readonly string[]
  readonly activities: ReadonlyMap<string, Activity>
  readonly locale: Locale
  readonly stats: () => StatusStats
}

function spinnerLines(state: FrameState, frameIndex: number): readonly string[] {
  const frame = state.frames[frameIndex % state.frames.length]

  return orderedLines({
    activities: state.activities,
    locale: state.locale,
    now: performance.now(),
    stats: state.stats(),
  }).map((line) => (line.spin ? `${frame} ${line.text}` : `${FRAME_BLANK}${line.text}`))
}

export function createActivityDisplay(
  output: ResearchProgressOutput,
  locale: Locale,
  stats: () => StatusStats
): ActivityDisplay {
  const interactive = isInteractiveStdout()
  const frames = isUnicode() ? UNICODE_FRAMES : ASCII_FRAMES
  const activities = new Map<string, Activity>()
  const block = createTransientBlock(output.writeRaw)
  let frameIndex = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let isPaused = false

  const draw = (): void => {
    if (!interactive || isPaused || activities.size === 0) {
      block.update([])
      return
    }

    block.update(spinnerLines({ frames, activities, locale, stats }, frameIndex))
    frameIndex += 1
  }

  // The timer runs exactly while frames should tick; every state change reconciles here.
  const sync = (): void => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }

    if (interactive && !isPaused && activities.size > 0) {
      timer = setInterval(draw, SPINNER_INTERVAL_MS)
      timer.unref()
    }
  }

  const store = createActivityStore(activities, () => {
    draw()
    sync()
  })

  return {
    set: store.set,
    remove: store.remove,
    clearKeyed: store.clearKeyed,

    printPersistent(line) {
      block.update([])
      output.writeLine(line)
      draw()
    },

    pause() {
      isPaused = true
      sync()
      block.update([])
    },

    resume() {
      isPaused = false
      draw()
      sync()
    },

    close() {
      isPaused = false
      activities.clear()
      sync()
      block.update([])
    },
  }
}

function createActivityStore(
  activities: Map<string, Activity>,
  onChange: () => void
): ActivityStore {
  return {
    set(key, label) {
      activities.set(key, { label, startedAt: performance.now() })
      onChange()
    },

    remove(key) {
      activities.delete(key)
      onChange()
    },

    clearKeyed() {
      for (const key of [...activities.keys()]) {
        if (key !== STATUS_KEY) {
          activities.delete(key)
        }
      }

      onChange()
    },
  }
}

function orderedLines(input: OrderedLinesInput): OrderedLine[] {
  const keyed: OrderedLine[] = []
  let status: Activity | undefined

  for (const [key, activity] of input.activities) {
    if (key === STATUS_KEY) {
      status = activity
      continue
    }
    keyed.push(activityLine(key, activity))
  }

  if (status === undefined) {
    return keyed
  }

  return [
    ...keyed,
    {
      text: composeStatusLine({
        status,
        stats: input.stats,
        locale: input.locale,
        now: input.now,
      }),
      spin: true,
    },
  ]
}

function activityLine(key: string, activity: Activity): OrderedLine {
  return { text: activity.label, spin: key.startsWith(QUESTION_PREFIX) }
}

function composeStatusLine(input: StatusLineInput): string {
  const label =
    input.stats.crawlActive && input.stats.questionTotal > 0
      ? t(input.locale, 'progress.researchStageCrawlProgress', {
          done: input.stats.terminalQuestionCount,
          total: input.stats.questionTotal,
        })
      : input.status.label
  const parts = [label]

  if (input.stats.searchCount > 0) {
    parts.push(
      t(
        input.locale,
        pluralKey(
          input.stats.searchCount,
          'progress.researchOperationSearchCountOne',
          'progress.researchOperationSearchCount'
        ),
        { count: input.stats.searchCount }
      )
    )
  }
  if (input.stats.fetchCount > 0) {
    parts.push(
      t(input.locale, 'progress.researchOperationFetchCount', {
        count: input.stats.fetchCount,
      })
    )
  }
  if (input.stats.showCancelHint) {
    parts.push(
      t(input.locale, 'progress.researchCancelHint', {
        elapsed: formatDuration(input.locale, input.now - input.status.startedAt),
      })
    )
  }

  return parts.join(' · ')
}

// One animated line per in-flight question/activity, plus a single pipeline-status line at the
// bottom. The block is always the last thing on screen: redraw erases the old rows, writes the
// new. Lines are never truncated — long text wraps at the terminal edge, so the erase counts
// visual rows, not logical lines.
function createTransientBlock(writeRaw: Writer): { update(lines: readonly string[]): void } {
  const terminal = currentTerminal()
  let rowCount = 0

  return {
    update(lines) {
      if (rowCount > 0) {
        writeRaw(`\x1b[${rowCount}F\x1b[J`)
      }

      const columns = terminal.stdout.columns
      const maxWidth =
        (columns === undefined || !Number.isFinite(columns) ? FALLBACK_COLUMNS : columns) - 1

      let rows = 0
      for (const line of lines) {
        rows += displayRows(line, maxWidth)
        writeRaw(`\x1b[K${line}\n`)
      }

      rowCount = rows
    },
  }
}

function displayRows(line: string, maxWidth: number): number {
  if (maxWidth < 1) {
    return 1
  }

  return Math.max(1, Math.ceil(Bun.stringWidth(line) / maxWidth))
}
