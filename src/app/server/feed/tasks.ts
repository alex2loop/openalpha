import type { FeedDeps } from '@/app/server/feed/relay'
import type { TaskStatusWire } from '@/app/server/wire/tasks'
import { APP_SOURCE } from '@/app/server/channel'

// Short enough to read as live; a pass inside it (the scheduler's tick) is one change, not two.
const TASKS_MIN_INTERVAL_MS = 250

/** What the feed reads of the daemon's task board. */
export interface TaskBoardReader {
  list(): readonly TaskStatusWire[]
  watch(gapMs: number, onChange: () => void): () => void
}

/** Tells open sockets the whole task list whenever a background task starts or ends a pass. */
export function followTasks({ broadcast }: FeedDeps, board: TaskBoardReader): () => void {
  return board.watch(TASKS_MIN_INTERVAL_MS, () => {
    broadcast({
      v: 1,
      kind: 'tasks_changed',
      weight: 'quiet',
      source: APP_SOURCE,
      tasks: board.list(),
    })
  })
}
