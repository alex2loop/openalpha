import type { AgentWire } from '@/app/server/wire/agents'
import { pluralKey } from '@/i18n'
import { agents, MIN_SHARED_NAMES } from '@/web/state/agents'
import { joinList } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

/** How it sits with the other agents: how often it agrees (once enough names are shared), how it
 *  did going against them, and whose calls it almost always matches. */
export function Relations({ agent }: { readonly agent: AgentWire }) {
  const { agreement, contrarian } = agent
  const overlaps = agent.overlapsWith.map(
    (agentId) => agents.value.find((held) => held.id === agentId)?.name ?? agentId
  )

  return (
    <section class="agent-section">
      {agreement !== undefined && agreement.comparedCount >= MIN_SHARED_NAMES && (
        <p>
          {tr('ui.office.agent.agrees', {
            matched: agreement.matchedCount,
            compared: agreement.comparedCount,
          })}
        </p>
      )}
      {contrarian !== undefined && (
        <p>
          {tr(
            pluralKey(
              contrarian.count,
              'ui.office.agent.contrarianOne',
              'ui.office.agent.contrarian'
            ),
            {
              count: contrarian.count,
              wins: contrarian.wins,
            }
          )}
        </p>
      )}
      {overlaps.length === 0 ? (
        <p class="meta">{tr('ui.office.agent.noOverlap')}</p>
      ) : (
        <p>{joinList(overlaps)}</p>
      )}
    </section>
  )
}
