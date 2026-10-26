import { effect, type ReadonlySignal, signal, untracked } from '@preact/signals'

import type { AgentDetailWire } from '@/app/server/wire/agents'
import type { MessageKey } from '@/i18n'
import { type AgentDraft, agentFormRequest, removeAgent, saveAgent } from '@/web/state/agents'
import { knownMarkets } from '@/web/state/market'
import { openView } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import {
  BudgetField,
  HorizonField,
  MarketsField,
  NameField,
  PromptField,
  SpawnField,
} from '@/web/ui/agent/form/fields'
import {
  type AgentForm,
  applyDraft,
  buildDraft,
  createAgentForm,
  snapshotForm,
} from '@/web/ui/agent/form/form-state'
import { LOOK_PATHS, LookPicker } from '@/web/ui/agent/form/look-picker'
import { ModelSelect } from '@/web/ui/agent/form/model-select'
import { SectorPills } from '@/web/ui/agent/form/sector-pills'
import { describeFailure } from '@/web/ui/dialogs/field-errors'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'

import './form.css'

// The fields of the body this form has a place for.
const AGENT_PATHS = [
  'id',
  'name',
  'systemPrompt',
  'focus.markets',
  'focus.sectors',
  'focus.horizon',
  'maxDailyUsd',
  'modelTier',
  'maxSpawn',
  ...LOOK_PATHS,
]

interface FormRequest {
  /** The agent to edit; absent creates one. */
  readonly detail?: AgentDetailWire
  /** What a new agent starts with, a template's fields; the operator edits it before saving. */
  readonly draft?: Partial<AgentDraft>
  readonly onSaved?: () => void
}

interface OpenForm {
  readonly form: AgentForm
  readonly request: FormRequest
  readonly initial: string
  handle?: ModalHandle
}

const saved = signal<{ readonly agentId: string; readonly name: string } | undefined>(undefined)

/** The agent just saved, for its desk to say the change holds at once. */
export const savedNote: ReadonlySignal<
  { readonly agentId: string; readonly name: string } | undefined
> = saved

/** Drops the note when its agent's desk closes. */
export function clearSavedNote(agentId: string): void {
  if (saved.value?.agentId === agentId) {
    saved.value = undefined
  }
}

/** The one dialog that creates or edits an agent. A refused save keeps it open with the daemon's
 *  sentence on top; a good one closes it and opens the agent's desk. */
export function openAgentForm(request: FormRequest = {}): void {
  const form = createAgentForm(request.detail)
  const initial = snapshotForm(form)

  if (request.detail === undefined && request.draft !== undefined) {
    applyDraft(
      form,
      request.draft,
      knownMarkets.value.map((market) => market.market)
    )
  }

  const open: OpenForm = { form, request, initial }
  const name = request.detail?.name

  open.handle = openModal({
    title:
      name === undefined ? tr('ui.office.form.addTitle') : tr('ui.office.form.editTitle', { name }),
    body: <FormBody form={form} />,
    footer: <FormFooter open={open} />,
    dirty: () => snapshotForm(form) !== open.initial,
    wide: true,
  })
}

/** Opens the form on each new `requestAgentForm` ask from the scene; the returned stop ends it. */
export function startAgentFormRequests(): () => void {
  let seen = agentFormRequest.peek()?.seq

  return effect(() => {
    const request = agentFormRequest.value

    if (request === undefined || request.seq === seen) {
      return
    }

    seen = request.seq
    untracked(() => openAgentForm(request.draft === undefined ? {} : { draft: request.draft }))
  })
}

function FormBody({ form }: { readonly form: AgentForm }) {
  return (
    <div class="agent-form">
      {form.failure.value !== undefined && (
        <p class="failure-line" role="alert">
          {form.failure.value}
        </p>
      )}
      <NameField form={form} />
      <PromptField form={form} />
      <MarketsField form={form} />
      <SectorPills form={form} />
      <HorizonField form={form} />
      <BudgetField form={form} />
      <ModelSelect form={form} />
      <SpawnField form={form} />
      <LookPicker form={form} />
    </div>
  )
}

function FormFooter({ open }: { readonly open: OpenForm }) {
  const { form } = open
  const { existing } = form

  return (
    <>
      <Button kind="commit" disabled={form.isBusy.value} onClick={() => submit(open)}>
        {tr(existing === undefined ? 'ui.office.form.create' : 'ui.office.common.save')}
      </Button>
      <Button onClick={() => open.handle?.close()}>{tr('ui.office.common.cancel')}</Button>
      {existing !== undefined && (
        <Button kind="destructive" onClick={() => askDelete(existing)}>
          {tr('ui.office.form.delete')}
        </Button>
      )}
    </>
  )
}

function submit(open: OpenForm): void {
  const { form } = open
  const draft = buildDraft(form)
  const missing = findMissing(draft)

  if (missing !== undefined) {
    form.failure.value = tr(missing)
    return
  }

  form.isBusy.value = true
  form.failure.value = undefined
  form.fields.value = new Map()
  saveAgent(draft, form.existing?.id)
    .then(
      () => {
        // A form closed while it saved does not pull the operator back to the desk.
        const isOpen = open.handle?.isOpen() === true

        saved.value = { agentId: draft.id, name: draft.name }
        open.handle?.close()
        open.request.onSaved?.()

        if (isOpen) {
          openView({ agent: draft.id })
        }
      },
      (error: unknown) => {
        const failed = describeFailure(error, AGENT_PATHS)

        form.fields.value = failed.fields
        form.failure.value =
          failed.top === undefined
            ? undefined
            : tr('ui.office.form.notSaved', { reason: failed.top })
      }
    )
    .finally(() => {
      form.isBusy.value = false
    })
}

function findMissing(draft: AgentDraft): MessageKey | undefined {
  if (draft.name === '') {
    return 'ui.office.form.needName'
  }

  return draft.systemPrompt === '' ? 'ui.office.form.needPrompt' : undefined
}

// The confirm replaces the form; the agent's desk goes with it once the daemon has removed it.
function askDelete(agent: AgentDetailWire): void {
  askConfirm({
    title: tr('ui.office.form.deleteAsk', { name: agent.name }),
    lines: [tr('ui.office.form.deleteBody')],
    confirmLabel: tr('ui.office.form.delete'),
    isDestructive: true,
    confirm: async () => {
      await removeAgent(agent.id)
      openView({ tab: 'today' }, { fresh: true })
    },
  })
}
