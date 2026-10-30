import type { ComponentChildren } from 'preact'

import type { DebateWire } from '@/app/server/wire/debate'
import type { SuggestionWire } from '@/app/server/wire/trading'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { toFailureText, tr } from '@/web/text/tr'
import { Fold } from '@/web/ui/kit/fold'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'

const BULL_ROLE = 'bull-researcher'
const BEAR_ROLE = 'bear-researcher'
const VERIFIER_ROLE = 'claim-verifier'
const ANALYST_ROLE = 'market-analyst'

type Side = typeof BULL_ROLE | typeof BEAR_ROLE
type Action = SuggestionWire['action']

/** One titled piece of a stored debate. */
interface DebatePart {
  readonly id: string
  readonly title: string
  readonly body: ComponentChildren
}

/** The stored debate of a call; a call with none stored (a plan the exit tick recorded) reads as
 *  absent, not as a failure. */
export async function readDebate(id: string, abort: AbortSignal): Promise<DebateWire | undefined> {
  try {
    return await getJson(ROUTES.suggestionDebate(id), { signal: abort })
  } catch (error: unknown) {
    if (error instanceof ApiFailure && error.code === 'not_found') {
      return undefined
    }

    throw error
  }
}

/** What a debate has to say, by the mode it ran in: a full one argued a buy case and a case
 *  against; a lean one only has its analyst. The claim check shows when it checked any claim. */
export function buildDebateParts(debate: DebateWire, action: Action): readonly DebatePart[] {
  const parts: DebatePart[] =
    debate.mode === 'full'
      ? [buildCasePart(debate, BULL_ROLE, action), buildCasePart(debate, BEAR_ROLE, action)]
      : buildAnalystParts(debate)

  if (debate.claims.length > 0) {
    parts.push({
      id: VERIFIER_ROLE,
      title: tr('ui.office.why.claims'),
      body: <ClaimList debate={debate} />,
    })
  }

  return parts
}

/** The buy case, the case against and the claim check of a stored debate, each in a fold. */
export function DebateFolds({ call }: { readonly call: SuggestionWire }) {
  const loaded = useLoad((abort) => readDebate(call.id, abort))
  const result = loaded.value

  if (result.status === 'loading') {
    return <Skeleton lines={2} />
  }

  if (result.status === 'failed') {
    return <p class="failure-line">{toFailureText(result.failure)}</p>
  }

  const parts = result.value === undefined ? [] : buildDebateParts(result.value, call.action)

  return (
    <>
      {parts.map((part) => (
        <Fold key={part.id} title={part.title}>
          {part.body}
        </Fold>
      ))}
    </>
  )
}

// One side's stored summary under the case it argues; a case the evidence refuted whole has none.
function buildCasePart(debate: DebateWire, side: Side, action: Action): DebatePart {
  const summary = debate.roles.find((role) => role.role === side)?.summary

  return {
    id: side,
    title: tr(resolveCaseKey(side, action)),
    body:
      summary === undefined ? <p class="meta">{tr('ui.office.why.dropped')}</p> : <p>{summary}</p>,
  }
}

function resolveCaseKey(side: Side, action: Action) {
  if (side === BULL_ROLE) {
    return action === 'reduce' ? 'ui.office.why.caseKeep' : 'ui.office.why.caseBuy'
  }

  return action === 'reduce' ? 'ui.office.why.caseSell' : 'ui.office.why.caseWait'
}

function buildAnalystParts(debate: DebateWire): DebatePart[] {
  const analyst = debate.roles.find((role) => role.role === ANALYST_ROLE)

  if (analyst?.summary === undefined) {
    return []
  }

  const { summary, verdict } = analyst

  return [
    {
      id: ANALYST_ROLE,
      title:
        verdict === undefined
          ? tr('ui.office.why.analyst')
          : tr('ui.office.why.analystStance', { stance: verdict }),
      body: <p>{summary}</p>,
    },
  ]
}

// The claims the call rests on, numbered; one the fact check refuted is struck through.
function ClaimList({ debate }: { readonly debate: DebateWire }) {
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
