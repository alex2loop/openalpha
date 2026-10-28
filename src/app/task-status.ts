import type { TaskStatusWire } from '@/app/server/wire/tasks'
import type { TaskPass, TaskPassListener } from '@/core/container'
import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import { t, translateDisplayText } from '@/i18n'

declare module '@/core/container' {
  interface Services {
    /** What each background task last did and when it runs next, for the page. */
    taskStatus: TaskStatusBoard
  }
}

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
  readonly working: boolean
}

interface TaskStatusBoard {
  readonly listener: TaskPassListener
  /** Names a task before its first pass, so a task that waits long for its first still shows. */
  track(names: readonly string[]): void
  list(): readonly TaskStatusWire[]
}

/** One entry per task name. The names are the daemon's own tasks, fixed once it has started, so
 *  the table never grows past them. */
export function createTaskStatusBoard(locale: Locale): TaskStatusBoard {
  const entries = new Map<string, TaskEntry>()

  return {
    listener: (pass) => {
      entries.set(pass.name, applyPass(locale, entries.get(pass.name), pass))
    },
    track: (names) => {
      for (const name of names) {
        if (!entries.has(name)) {
          entries.set(name, { working: false })
        }
      }
    },
    list: () => [...entries].map(([name, entry]) => toStatusWire(locale, name, entry)),
  }
}

function applyPass(locale: Locale, current: TaskEntry | undefined, pass: TaskPass): TaskEntry {
  const everyMs = pass.everyMs ?? current?.everyMs

  if (pass.phase === 'start') {
    return { ...current, ...(everyMs === undefined ? {} : { everyMs }), working: true }
  }

  return {
    ...(everyMs === undefined ? {} : { everyMs }),
    lastRunAt: pass.at,
    ...(pass.error === undefined ? {} : { lastError: translateDisplayText(locale, pass.error) }),
    ...(pass.nextAt === undefined ? {} : { nextRunAt: pass.nextAt }),
    working: false,
  }
}

function toStatusWire(locale: Locale, name: string, entry: TaskEntry): TaskStatusWire {
  const key = LABEL_KEYS.get(name)

  return { name, label: key === undefined ? name : t(locale, key), ...entry }
}
