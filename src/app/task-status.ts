import type { TaskStatusWire } from '@/app/server/wire/tasks'
import type { TaskPass, TaskPassListener, TaskSnapshot } from '@/core/container'
import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import { MS_PER_SECOND } from '@/core/utils/time'
import { t, translateDisplayText } from '@/i18n'

declare module '@/core/container' {
  interface Services {
    /** What each background task last did and when it runs next, for the page. */
    taskStatus: TaskStatusBoard
  }
}

// A pass that starts and ends inside this gap (the scheduler's tick) settles unseen, so a reader
// outside the daemon hears of a change it could notice, not of every pass.
const TASK_REPORT_GAP_MS = 5 * MS_PER_SECOND

const LABEL_KEYS: ReadonlyMap<string, MessageKey> = new Map([
  ['trading.alerts', 'ui.task.trading.alerts'],
  ['trading.exits', 'ui.task.trading.exits'],
  ['trading.refresh', 'ui.task.trading.refresh'],
  ['trading.briefs', 'ui.task.trading.briefs'],
  ['trading.intraday', 'ui.task.trading.intraday'],
  ['trading.outcomes', 'ui.task.trading.outcomes'],
  ['trading.macro-extract', 'ui.task.trading.macro-extract'],
  ['trading.theme-outcomes', 'ui.task.trading.theme-outcomes'],
  ['trading.intents', 'ui.task.trading.intents'],
  ['scheduler', 'ui.task.scheduler'],
  ['retention', 'ui.task.retention'],
  ['update', 'ui.task.update'],
  ['social', 'ui.task.social'],
  ['channels.watch', 'ui.task.channels.watch'],
  ['workflows', 'ui.task.workflows'],
])

interface TaskEntry {
  readonly everyMs?: number
  readonly lastRunAt?: number
  readonly lastError?: string
  readonly nextRunAt?: number
  /** Passes in flight: the start's market data sweep reports under the refresh loop it joins. */
  readonly passes: number
}

interface TaskStatusBoard {
  readonly listener: TaskPassListener
  /** Names a task before its first pass, so a task that waits long for its first still shows. */
  track(names: readonly string[]): void
  list(): readonly TaskStatusWire[]
  /** Calls `onChange` once per `gapMs` that saw a pass edge, until the returned stop is called;
   *  a pass that starts and ends inside one gap reads as one change. */
  watch(gapMs: number, onChange: () => void): () => void
}

/** One entry per task name. The names are the daemon's own tasks, fixed once it has started, so
 *  the table never grows past them. */
export function createTaskStatusBoard(locale: Locale): TaskStatusBoard {
  const entries = new Map<string, TaskEntry>()
  const watchers = new Set<() => void>()

  return {
    listener: (pass) => {
      entries.set(pass.name, applyPass(locale, entries.get(pass.name), pass))

      for (const onChange of watchers) {
        onChange()
      }
    },
    track: (names) => {
      for (const name of names) {
        if (!entries.has(name)) {
          entries.set(name, { passes: 0 })
        }
      }
    },
    list: () => [...entries].map(([name, entry]) => toStatusWire(locale, name, entry)),
    watch: (gapMs, onChange) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const fire = (): void => {
        timer = undefined

        try {
          onChange()
        } catch {
          // Runs on its own timer, where a throw would end the daemon: a status display is not worth it.
        }
      }
      const onPass = (): void => {
        timer ??= setTimeout(fire, gapMs)
      }

      watchers.add(onPass)

      return () => {
        watchers.delete(onPass)
        clearTimeout(timer)
      }
    },
  }
}

function applyPass(locale: Locale, current: TaskEntry | undefined, pass: TaskPass): TaskEntry {
  const everyMs = pass.everyMs ?? current?.everyMs
  const passes = current?.passes ?? 0

  if (pass.phase === 'start') {
    return { ...current, ...(everyMs === undefined ? {} : { everyMs }), passes: passes + 1 }
  }

  const nextRunAt = pass.nextAt ?? current?.nextRunAt

  return {
    ...(everyMs === undefined ? {} : { everyMs }),
    lastRunAt: pass.at,
    ...(pass.error === undefined ? {} : { lastError: translateDisplayText(locale, pass.error) }),
    ...(nextRunAt === undefined ? {} : { nextRunAt }),
    passes: Math.max(0, passes - 1),
  }
}

function toStatusWire(locale: Locale, name: string, entry: TaskEntry): TaskStatusWire {
  const key = LABEL_KEYS.get(name)
  const { passes, ...shown } = entry

  return { name, label: key === undefined ? name : t(locale, key), ...shown, working: passes > 0 }
}

/** Hands `onTasks` the board now, then again whenever which tasks work, or failed, changes. */
export function reportTaskChanges(
  board: TaskStatusBoard,
  onTasks: (tasks: readonly TaskSnapshot[]) => void
): () => void {
  let reported = ''

  const report = (): void => {
    const tasks = board.list().map(toSnapshot)
    const key = JSON.stringify(tasks)

    if (key !== reported) {
      reported = key
      onTasks(tasks)
    }
  }
  const unwatch = board.watch(TASK_REPORT_GAP_MS, report)

  report()

  return unwatch
}

function toSnapshot(task: TaskStatusWire): TaskSnapshot {
  const { label, working, lastError } = task

  return { label, working, ...(lastError === undefined ? {} : { lastError }) }
}
