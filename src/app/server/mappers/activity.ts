import type { ActivityRowWire, ResearchReportWire } from '@/app/server/wire/activity'
import type { RunId } from '@/core/ids'
import type { RunLogRow } from '@/persistence/api'

interface ActivityTree {
  readonly costs: ReadonlyMap<RunId, number>
  readonly children: ReadonlyMap<RunId, readonly RunLogRow[]>
}

/** A run with the cost of its whole subtree and its direct children, each priced the same way. */
export function toActivityRowWire(row: RunLogRow, tree: ActivityTree): ActivityRowWire {
  const children = tree.children.get(row.runId) ?? []

  return {
    ...toRowWire(row, tree.costs),
    ...(children.length === 0
      ? {}
      : { children: children.map((child) => toRowWire(child, tree.costs)) }),
  }
}

function toRowWire(row: RunLogRow, costs: ReadonlyMap<RunId, number>): ActivityRowWire {
  return {
    runId: row.runId,
    kind: row.kind,
    name: row.name,
    ...(row.title === undefined ? {} : { title: row.title }),
    ...(row.summary === undefined ? {} : { summary: row.summary }),
    channelId: row.channel ?? '',
    ...(row.agentId === undefined ? {} : { agentId: row.agentId }),
    ...(row.parentRunId === undefined ? {} : { parentRunId: row.parentRunId }),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    outcome: row.outcome,
    costUsd: costs.get(row.runId) ?? 0,
  }
}

/** Undefined for a run with no session: its report cannot be opened, so the list leaves it out. */
export function toResearchReportWire(row: RunLogRow): ResearchReportWire | undefined {
  if (row.sessionId === undefined) {
    return undefined
  }

  return {
    runId: row.runId,
    ...(row.title === undefined ? {} : { title: row.title }),
    sessionId: row.sessionId,
    channelId: row.channel ?? '',
    endedAt: row.endedAt,
    outcome: row.outcome,
    ...(row.sources === undefined ? {} : { sources: row.sources }),
  }
}
