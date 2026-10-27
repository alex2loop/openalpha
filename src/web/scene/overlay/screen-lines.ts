import type { ProgressWire } from '@/app/server/wire/live'
import type { DeskScreenContent, ScreenLine } from '@/web/scene/overlay-types'
import type { Run } from '@/web/state/live'
import { toParamText } from '@/web/scene/data/room-status'
import { DONE_GLYPH, PROMPT_GLYPH, STEP_GLYPH } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'

// A screen keeps this many finished steps; what shows is cut to its rows.
const DONE_LINES_MAX = 6
const COMMAND_ID = 'command'

/** The ticker a run works on: the one its progress names, else the first it has touched. */
export function tickerOf(run: Run): string | undefined {
  return toParamText(run.progress?.params?.ticker) ?? run.tickers[0]
}

/** A run's terminal, as the mockup types one: `$ name ticker`, then a line for every step it has
 *  finished and the step it is on, which reads the page's host while a scout has one open. */
export function terminalLinesOf(run: Run, host?: string): readonly ScreenLine[] {
  const running = runningStepOf(run)
  const done = run.persistent.slice(-DONE_LINES_MAX).map((step) => lineOf('done', step))

  return [
    {
      kind: 'command',
      id: COMMAND_ID,
      text: [PROMPT_GLYPH, run.name, tickerOf(run)].filter(Boolean).join(' '),
    },
    ...done,
    ...(running === undefined ? [] : [lineOf('step', running, host)]),
  ]
}

/** What a desk screen shows for a run: its title and terminal. */
export function runContentOf(run: Run): DeskScreenContent {
  return { kind: 'run', title: formatRunName(run), lines: terminalLinesOf(run) }
}

function lineOf(kind: 'done' | 'step', step: ProgressWire, host?: string): ScreenLine {
  const glyph = kind === 'done' ? DONE_GLYPH : STEP_GLYPH

  return { kind, id: `${step.at}:${step.key}`, text: `${glyph} ${host ?? step.text}` }
}

// The latest line, unless it is the persistent step already listed as done.
function runningStepOf(run: Run): ProgressWire | undefined {
  const { progress } = run
  const last = run.persistent.at(-1)

  return progress === undefined || (last?.at === progress.at && last.key === progress.key)
    ? undefined
    : progress
}
