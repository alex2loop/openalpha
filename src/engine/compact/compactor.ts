import type { LLMMessage } from '@/core/llm'
import type { SummarizerFn } from '@/engine/compact/summarizer'
import type { Compactor, RunView } from '@/engine/types/run'
import { LLMError, RunHalted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { applyRepairSequence, groupMessages } from '@/engine/compact/message-repair'
import {
  COMPACT_ELIDED_TOOL_RESULT,
  COMPACT_KEEP_RECENT_GROUPS,
  COMPACT_SUMMARY_PREAMBLE,
} from '@/engine/constants'
import { estimateTokens } from '@/engine/loop/limits'
import { compactionRoomTokens } from '@/engine/loop/run-compaction'

const SUMMARY_FALLBACK = '[CONTEXT TRUNCATED - summarization failed, older messages removed]'

interface CompactorDeps {
  readonly summarizer: SummarizerFn
}

// Stub tool-result bodies outside the recent-group window. Messages stay in place (an orphaned
// assistant tool_call with no tool reply is a malformed transcript), only content shrinks.
function elideStaleToolResults(
  msgs: readonly LLMMessage[],
  keepRecentGroups: number
): readonly LLMMessage[] {
  const { mid, recent } = sliceByGroups(msgs, keepRecentGroups)
  let changed = false

  const elided = mid.map((msg) => {
    if (msg.role !== 'tool' || msg.content === COMPACT_ELIDED_TOOL_RESULT) {
      return msg
    }

    changed = true
    return { ...msg, content: COMPACT_ELIDED_TOOL_RESULT }
  })

  return changed ? [...elided, ...recent] : msgs
}

// Provider failures fall back to plain tool-pair repair. Run halts still propagate after the
// summarizer settles incurred attempts, and run.ts owns the compaction-pass cap.
export function createSummarizingCompactor(deps: CompactorDeps): Compactor {
  return {
    async compact(run): Promise<void> {
      const history = run.state.messages.history
      const elided = elideStaleToolResults(history, COMPACT_KEEP_RECENT_GROUPS)
      const room = compactionRoomTokens(run.env.limits)

      if (elided !== history && room > 0 && estimateTokens(elided) <= room) {
        run.state.messages.replaceAll(applyRepairSequence(elided, run))
        run.services.logger.info('compact.elided', { messages: history.length })

        return
      }

      try {
        run.state.messages.replaceAll(await summarizePath(run, elided, deps))

        return
      } catch (err: unknown) {
        if (err instanceof RunHalted) {
          throw err
        }

        const repaired = applyRepairSequence(elided, run)

        run.state.messages.replaceAll(repaired)
        run.services.logger.warn('compact.failed', { err: formatErrForLog(err) })
      }
    },
  }
}

// Mirrors commitTurn's usage settlement: per-run budget, daily/monthly + durable ledger, and totals.
// Compaction produces no turn/metric — it is overhead on an existing run.
async function summarizePath(
  run: RunView,
  history: readonly LLMMessage[],
  deps: CompactorDeps
): Promise<LLMMessage[]> {
  const { mid, recent } = sliceByGroups(history, COMPACT_KEEP_RECENT_GROUPS)
  const head = history[0]
  const preserved = head?.role === 'system' && recent[0] !== head ? [head] : []
  const middle = mid.slice(preserved.length)

  if (middle.length === 0) {
    return applyRepairSequence([...preserved, ...recent], run)
  }

  const text = await callSummarizer(middle, run, deps)
  const summaryMsg: LLMMessage = { role: 'user', content: `${COMPACT_SUMMARY_PREAMBLE}${text}` }

  return applyRepairSequence([...preserved, summaryMsg, ...recent], run)
}

async function callSummarizer(
  middle: readonly LLMMessage[],
  run: RunView,
  deps: CompactorDeps
): Promise<string> {
  const input = buildSummaryInput(middle)

  try {
    return (await deps.summarizer(input, run, run.state.abort.signal)).text
  } catch (err: unknown) {
    if (!(err instanceof LLMError)) {
      throw err
    }

    run.services.logger.warn('compact.summary_failed', { err: formatErrForLog(err) })

    return SUMMARY_FALLBACK
  }
}

// Thinking blocks are dropped: they are the most expensive part of the input and worthless
// to a summarizer, and they must round-trip verbatim or not at all.
function buildSummaryInput(msgs: readonly LLMMessage[]): string {
  return msgs
    .map((msg) => {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)

      return `[${msg.role}]: ${text}`
    })
    .join('\n')
}

// The recent window is the last `keepGroups` assistant/tool groups, so a run driven by one user
// message still has an older region to shrink and a tool result never parts from its call.
function sliceByGroups(
  msgs: readonly LLMMessage[],
  keepGroups: number
): { readonly mid: readonly LLMMessage[]; readonly recent: readonly LLMMessage[] } {
  const groups = groupMessages(msgs)
  const older = groups.slice(0, Math.max(0, groups.length - keepGroups))
  const cut = older.reduce((count, group) => count + group.length, 0)

  return { mid: msgs.slice(0, cut), recent: msgs.slice(cut) }
}
