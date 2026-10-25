import type { ReadonlySignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'

import type { DebateWire } from '@/app/server/wire/debate'
import type { SuggestionWire } from '@/app/server/wire/trading'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { toFailureText, tr } from '@/web/text/tr'
import { Fold } from '@/web/ui/kit/fold'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { type LoadState, useLazyLoad } from '@/web/ui/kit/use-load'

const BULL_ROLE = 'bull-researcher'
const BEAR_ROLE = 'bear-researcher'
const VERIFIER_ROLE = 'claim-verifier'

type Side = typeof BULL_ROLE | typeof BEAR_ROLE

/** The buy case, the case against and the claim check of a stored debate, each in a fold. The
 *  debate is read once, when the first fold opens. */
export function DebateFolds({ call }: { readonly call: SuggestionWire }) {
  const { result, request } = useLazyLoad((abort) =>
    getJson(ROUTES.suggestionDebate(call.id), { signal: abort })
  )

  return (
    <>
      <Fold title={tr(`trading.debate.role.${BULL_ROLE}`)} onOpen={request}>
        <DebatePart result={result}>
          {(debate) => <CaseLine debate={debate} side={BULL_ROLE} action={call.action} />}
        </DebatePart>
      </Fold>
      <Fold title={tr(`trading.debate.role.${BEAR_ROLE}`)} onOpen={request}>
        <DebatePart result={result}>
          {(debate) => <CaseLine debate={debate} side={BEAR_ROLE} action={call.action} />}
        </DebatePart>
      </Fold>
      <Fold title={tr(`trading.debate.role.${VERIFIER_ROLE}`)} onOpen={request}>
        <DebatePart result={result}>{(debate) => <ClaimList debate={debate} />}</DebatePart>
      </Fold>
    </>
  )
}

interface DebatePartProps {
  readonly result: ReadonlySignal<LoadState<DebateWire>>
  readonly children: (debate: DebateWire) => ComponentChildren
}

function DebatePart({ result, children }: DebatePartProps) {
  const state = result.value

  if (state.status === 'loading') {
    return <Skeleton lines={2} />
  }

  return state.status === 'failed' ? (
    <p class="failure-line">{toFailureText(state.failure)}</p>
  ) : (
    children(state.value)
  )
}

interface CaseLineProps {
  readonly debate: DebateWire
  readonly side: Side
  readonly action: SuggestionWire['action']
}

/** One side's stored summary in the daemon's own line; a case the evidence refuted whole has none. */
export function CaseLine({ debate, side, action }: CaseLineProps) {
  const summary = debate.roles.find((role) => role.role === side)?.summary

  if (summary === undefined) {
    return <p class="meta">{tr('ui.office.why.dropped')}</p>
  }

  return <p>{tr(resolveCaseKey(side, action), { summary })}</p>
}

function resolveCaseKey(side: Side, action: SuggestionWire['action']) {
  if (side === BULL_ROLE) {
    return action === 'reduce'
      ? 'trading.render.suggestion.debateBullReduce'
      : 'trading.render.suggestion.debateBull'
  }

  return action === 'reduce'
    ? 'trading.render.suggestion.debateBearReduce'
    : 'trading.render.suggestion.debateBear'
}

/** The claims the call rests on, numbered; one the fact check refuted is struck through. */
export function ClaimList({ debate }: { readonly debate: DebateWire }) {
  const refuted = new Set(debate.refutedIds)

  return (
    <ol class="claims">
      {debate.claims.map((claim) => (
        <li key={claim.id}>
          {refuted.has(claim.id) ? (
            <>
              <s>{claim.text}</s> <span class="meta">{tr('ui.office.why.dropped')}</span>
            </>
          ) : (
            claim.text
          )}
        </li>
      ))}
    </ol>
  )
}
