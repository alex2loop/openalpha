import type { DebateWire } from '@/app/server/wire/debate'
import type { SuggestionWire } from '@/app/server/wire/trading'
import { formatDay } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { agents } from '@/web/state/agents'
import { fillInput } from '@/web/state/command'
import { isAdvanced } from '@/web/state/prefs'
import { locale, state } from '@/web/state/session'
import { citationsOf } from '@/web/text/card-sources'
import { formatSignedFraction } from '@/web/text/figures'
import { ABSENT_CELL } from '@/web/text/glyphs'
import { formatWhen } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { buildDebateParts, readDebate } from '@/web/ui/ideas/debate-folds'
import { Button } from '@/web/ui/kit/button'
import { Fold } from '@/web/ui/kit/fold'
import { closeModal, openModal } from '@/web/ui/kit/modal'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { Markdown } from '@/web/ui/markdown/markdown'

/** The call a dialog explains. It carries the stored call itself: the daemon has no read of one
 *  call by id, and the dialog needs its name, action, day and outcome. */
type WhySubject =
  | { readonly kind: 'plan'; readonly call: SuggestionWire }
  | { readonly kind: 'opinion'; readonly agentId: string; readonly call: SuggestionWire }
  | { readonly kind: 'past'; readonly call: SuggestionWire }

interface StoredDebate {
  readonly debate: DebateWire | undefined
  readonly citations: readonly string[]
}

/** Opens "Vì sao?": what the daemon stored about how a call was reached. It reads stored data and
 *  costs nothing; "Hỏi sâu hơn" only fills the box with a question for the operator to send. */
export function openWhy(subject: WhySubject): void {
  openModal({
    title: buildTitle(subject),
    body: <WhyBody subject={subject} />,
    footer: <WhyFooter subject={subject} />,
    wide: true,
  })
}

// The action in the middle of a sentence reads lower case.
function actionOf(call: SuggestionWire): string {
  return tr(`trading.action.${call.action}`).toLocaleLowerCase(locale.value)
}

function buildTitle(subject: WhySubject): string {
  const { call } = subject
  const ticker = call.instrument.ticker

  switch (subject.kind) {
    case 'plan':
      return tr('ui.office.why.plan', { action: actionOf(call), ticker })
    case 'opinion':
      return tr('ui.office.why.opinion', {
        agent: agentName(subject.agentId),
        verdict: actionOf(call),
        ticker,
      })
    case 'past':
      return tr('ui.office.why.past', {
        action: actionOf(call),
        ticker,
        day: formatDay(locale.value, call.at),
      })
  }
}

function buildQuestion(subject: WhySubject): string {
  const { call } = subject
  const ticker = call.instrument.ticker
  const day = formatDay(locale.value, call.at)

  switch (subject.kind) {
    case 'plan':
      return tr('ui.office.why.askPlan', { ticker, action: actionOf(call) })
    case 'opinion':
      return tr('ui.office.why.askOpinion', { verdict: actionOf(call), ticker, day })
    case 'past':
      return tr('ui.office.why.askPast', { action: actionOf(call), ticker, day })
  }
}

function agentName(agentId: string): string {
  return agents.value.find((agent) => agent.id === agentId)?.name ?? agentId
}

function WhyFooter({ subject }: { readonly subject: WhySubject }) {
  return (
    <>
      <Button onClick={closeModal}>{tr('ui.office.common.close')}</Button>
      <Button
        kind="ai"
        onClick={() => {
          closeModal()
          fillInput(
            buildQuestion(subject),
            subject.kind === 'opinion' ? { agentId: subject.agentId } : {}
          )
        }}
      >
        {tr('ui.office.why.digDeeper')}
      </Button>
    </>
  )
}

function WhyBody({ subject }: { readonly subject: WhySubject }) {
  return (
    <>
      <Reason call={subject.call} />
      {subject.kind === 'plan' && <StoredDebateView call={subject.call} />}
      {subject.kind === 'opinion' && <AgentBrief agentId={subject.agentId} />}
      {subject.kind === 'past' && <PastResult call={subject.call} />}
      <p class="meta why-stored">{tr('ui.office.why.stored')}</p>
    </>
  )
}

function Reason({ call }: { readonly call: SuggestionWire }) {
  return call.thesis === undefined ? null : <p>{call.thesis}</p>
}

function AgentBrief({ agentId }: { readonly agentId: string }) {
  const agent = agents.value.find((held) => held.id === agentId)

  return agent === undefined ? null : <p class="meta">{agent.focusLabel}</p>
}

function PastResult({ call }: { readonly call: SuggestionWire }) {
  const { outcome } = call

  return (
    <>
      <p>
        {outcome === undefined
          ? tr('ui.office.ticker.outcome.open')
          : tr('ui.office.why.outcome', {
              outcome: tr(`trading.outcome.${outcome.status}`),
              return: formatSignedFraction(outcome.returnPct),
            })}
      </p>
      <p class="meta">{tr('ui.office.why.kept')}</p>
    </>
  )
}

// A plan the exit tick recorded has no stored debate; the dialog then shows the reason alone.
async function readStored(id: string, abort: AbortSignal): Promise<StoredDebate> {
  const [debate, card] = await Promise.all([
    readDebate(id, abort),
    getJson(ROUTES.suggestionCard(id), { signal: abort }),
  ])

  return { debate, citations: card.card === null ? [] : citationsOf(card.card) }
}

function StoredDebateView({ call }: { readonly call: SuggestionWire }) {
  const loaded = useLoad((abort) => readStored(call.id, abort))
  const result = loaded.value

  if (result.status === 'loading') {
    return <Skeleton />
  }

  if (result.status === 'failed') {
    return <p class="failure-line">{toFailureText(result.failure)}</p>
  }

  const { debate, citations } = result.value

  return (
    <>
      {debate !== undefined && <DebateSections debate={debate} action={call.action} />}
      {isAdvanced.value && citations.length > 0 && <CitationSection citations={citations} />}
      {debate !== undefined && <SetupUsed debate={debate} />}
    </>
  )
}

interface DebateSectionsProps {
  readonly debate: DebateWire
  readonly action: SuggestionWire['action']
}

function DebateSections({ debate, action }: DebateSectionsProps) {
  const timeZone = state.value?.timeZone

  return (
    <>
      <p class="meta">
        {tr('ui.office.why.run', {
          mode: tr(debate.mode === 'full' ? 'ui.office.why.modeFull' : 'ui.office.why.modeLean'),
          steps: debate.steps,
          time: timeZone === undefined ? ABSENT_CELL : formatWhen(debate.createdAt, timeZone),
        })}
      </p>
      {buildDebateParts(debate, action).map((part) => (
        <section key={part.id}>
          <h3 class="sub-head">{part.title}</h3>
          {part.body}
        </section>
      ))}
    </>
  )
}

function CitationSection({ citations }: { readonly citations: readonly string[] }) {
  return (
    <>
      <h3 class="sub-head">
        {tr(
          citations.length === 1
            ? 'ui.office.common.sourcesReadOne'
            : 'ui.office.common.sourcesRead',
          { count: citations.length }
        )}
      </h3>
      <Markdown text={citations.map((line) => `- ${line}`).join('\n')} isLinked={false} />
    </>
  )
}

function SetupUsed({ debate }: { readonly debate: DebateWire }) {
  return (
    <Fold title={tr('ui.office.why.config')}>
      <p class="meta">
        {tr('ui.office.why.configBody', {
          models: debate.models.length === 0 ? ABSENT_CELL : debate.models.join(', '),
          version: debate.strategyVersion,
          through:
            debate.evidenceThrough === undefined
              ? ABSENT_CELL
              : formatDay(locale.value, debate.evidenceThrough),
        })}
      </p>
    </Fold>
  )
}
