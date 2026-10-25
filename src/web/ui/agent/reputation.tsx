import type { AgentWire } from '@/app/server/wire/agents'
import { pluralKey } from '@/i18n'
import { state } from '@/web/state/session'
import { tr } from '@/web/text/tr'

/** Its standing from scored calls: the hit count once the trial sample is reached, else how far
 *  into the trial it is. Absent until the daemon's minimum is known. */
export function Reputation({ agent }: { readonly agent: AgentWire }) {
  const min = state.value?.trackRecordMinSample

  if (min === undefined) {
    return null
  }

  const count = agent.record?.resolvedCount ?? 0
  const hit = agent.record?.targetCount ?? 0

  return (
    <section class="agent-section">
      {count >= min ? (
        <p>
          {tr(pluralKey(count, 'ui.office.agent.repHitOne', 'ui.office.agent.repHit'), {
            hit,
            count,
          })}
        </p>
      ) : (
        <>
          <p>
            <span class="agent-tag">
              {tr(pluralKey(count, 'ui.office.agent.trialOne', 'ui.office.agent.trial'), {
                count,
                min,
              })}
            </span>
          </p>
          <p class="meta">{tr('ui.office.agent.trialNote', { min })}</p>
        </>
      )}
    </section>
  )
}

/** "Thành tích: 9 đề xuất đã chấm, 5 chạm mục tiêu...": the record while it is still small;
 *  absent before the first scored call and once the trial is over. */
export function RecordSentence({ agent }: { readonly agent: AgentWire }) {
  const min = state.value?.trackRecordMinSample
  const { record } = agent

  if (
    record === undefined ||
    record.resolvedCount === 0 ||
    (min !== undefined && record.resolvedCount >= min)
  ) {
    return null
  }

  const count = record.resolvedCount

  return (
    <p class="meta">
      {tr(pluralKey(count, 'ui.office.agent.repSmallOne', 'ui.office.agent.repSmall'), {
        count,
        hit: record.targetCount,
      })}
    </p>
  )
}
