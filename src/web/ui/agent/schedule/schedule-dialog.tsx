import type { AgentView } from '@/web/ui/agent/agent-view'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { estimateText } from '@/web/state/estimates'
import { loadSession, state } from '@/web/state/session'
import { formatUsd } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { formatMarketPrice } from '@/web/text/market-price'
import { describeEvent } from '@/web/text/schedule-event'
import { tr } from '@/web/text/tr'
import { EventFields, TimeFields } from '@/web/ui/agent/schedule/schedule-fields'
import {
  buildJobBody,
  createScheduleForm,
  isRunAtSet,
  REPEAT_LABELS,
  resolvePriceTrigger,
  type ScheduleForm,
} from '@/web/ui/agent/schedule/schedule-state'
import { describeFailure } from '@/web/ui/dialogs/field-errors'
import { FieldNote } from '@/web/ui/dialogs/field-note'
import { Button } from '@/web/ui/kit/button'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'
import { Segmented } from '@/web/ui/kit/segmented'

import '@/web/ui/agent/form/form.css'

// The fields of the job body this dialog has a place for.
const SCHEDULE_PATHS = [
  'prompt',
  'schedule.expr',
  'schedule.at',
  'schedule.ticker',
  'schedule.threshold',
  'schedule.cooldownMs',
]
const COMMAND_PREFIX = '/'
const WORD_BREAK = /\s+/

interface ScheduleRequest {
  readonly view: AgentView
  /** How often the alert pass checks an event, in seconds, as the jobs list words it. */
  readonly seconds: string | number
}

interface OpenSchedule {
  readonly form: ScheduleForm
  readonly request: ScheduleRequest
  handle?: ModalHandle
}

/** "Thêm lịch": a time it runs at, or a thing that has to happen first. It only files the job;
 *  nothing runs, and nothing spends AI, until the time comes or the event fires. */
export function openScheduleDialog(request: ScheduleRequest): void {
  const form = createScheduleForm(request.view.daemonId)
  const open: OpenSchedule = { form, request }

  open.handle = openModal({
    title: tr('ui.office.schedule.title', { agent: request.view.name }),
    body: <ScheduleBody open={open} />,
    footer: <ScheduleFooter open={open} />,
    dirty: () => form.work.value.trim() !== '' || form.level.value.trim() !== '',
  })
}

function ScheduleBody({ open }: { readonly open: OpenSchedule }) {
  const { form } = open

  return (
    <div class="agent-form">
      {form.failure.value !== undefined && (
        <p class="failure-line" role="alert">
          {form.failure.value}
        </p>
      )}
      <Segmented
        label={tr('ui.office.schedule.when')}
        value={form.mode.value}
        options={[
          { value: 'time', label: tr('ui.office.schedule.byTime') },
          { value: 'event', label: tr('ui.office.schedule.onEvent') },
        ]}
        onChange={(value) => {
          form.mode.value = value
        }}
      />
      {form.mode.value === 'time' ? <TimeFields form={form} /> : <EventFields form={form} />}
      {form.mode.value === 'event' && form.event.value === 'price' && <DirectionLine form={form} />}
      <WorkField form={form} />
      {form.mode.value === 'event' && <EventNotes open={open} />}
      {form.work.value.trim() !== '' && <p class="meta">{describePreview(open)}</p>}
    </div>
  )
}

function WorkField({ form }: { readonly form: ScheduleForm }) {
  return (
    <label class="form-field form-label">
      {tr('ui.office.schedule.work')}
      <input
        type="text"
        value={form.work.value}
        placeholder={tr('ui.office.schedule.workPlaceholder')}
        onInput={(event) => {
          form.work.value = event.currentTarget.value
        }}
      />
      <FieldNote message={form.fields.value.get('prompt')} />
    </label>
  )
}

// "vượt" or "thủng", from the level against today's price; nothing until both are known.
function DirectionLine({ form }: { readonly form: ScheduleForm }) {
  const trigger = resolvePriceTrigger(form)
  const { quote, condition } = trigger ?? {}

  if (quote === undefined || condition === undefined) {
    return null
  }

  return (
    <p class="meta">
      {tr('ui.office.schedule.dirAuto', {
        dir: tr(`trading.alert.condition.${condition}`),
        price: formatMarketPrice(quote.market, quote.last, quote.kind),
      })}
    </p>
  )
}

// The check is free; a run costs what the typed command usually costs, against the agent's budget.
function EventNotes({ open }: { readonly open: OpenSchedule }) {
  const { form, request } = open
  const work = form.work.value.trim()
  const estimate = work.startsWith(COMMAND_PREFIX)
    ? estimateText(work.split(WORD_BREAK, 1)[0] ?? '')
    : undefined
  const budget = request.view.agent?.maxDailyUsd
  const params = { seconds: request.seconds, agent: request.view.name }

  return (
    <>
      <p class="meta">{tr('ui.office.schedule.eventNote')}</p>
      <p class="meta">
        {estimate === undefined || budget === undefined
          ? tr('ui.office.schedule.costNoFigure', params)
          : tr('ui.office.schedule.cost', { ...params, estimate, budget: formatUsd(budget) })}
      </p>
    </>
  )
}

function describePreview(open: OpenSchedule): string {
  const { form, request } = open
  const when =
    form.mode.value === 'time'
      ? joinInline([tr(REPEAT_LABELS[form.repeat.value]), form.runAt.value])
      : describeEvent({
          event: form.event.value,
          ...(form.ticker.value.trim() === ''
            ? {}
            : { ticker: form.ticker.value.trim().toUpperCase() }),
        })

  return tr('ui.office.schedule.preview', {
    when,
    agent: request.view.name,
    what: form.work.value.trim(),
  })
}

function ScheduleFooter({ open }: { readonly open: OpenSchedule }) {
  return (
    <>
      <Button kind="commit" disabled={open.form.isBusy.value} onClick={() => submit(open)}>
        {tr('ui.office.common.save')}
      </Button>
      <Button onClick={() => open.handle?.close()}>{tr('ui.office.common.cancel')}</Button>
    </>
  )
}

// The schedules live in `/v1/state`, so it is read again before the dialog closes.
function submit(open: OpenSchedule): void {
  const { form } = open
  const timeZone = state.value?.timeZone

  if (timeZone === undefined) {
    form.failure.value = tr('ui.office.error.generic')
    return
  }

  const body = buildJobBody(form, timeZone)

  if (body === undefined) {
    form.failure.value = tr(
      form.mode.value === 'time' && !isRunAtSet(form)
        ? 'ui.office.schedule.timeNeeded'
        : 'ui.office.schedule.levelNeeded'
    )
    return
  }

  form.isBusy.value = true
  form.failure.value = undefined
  form.fields.value = new Map()
  sendJson('POST', ROUTES.jobs, { body })
    .then(() => loadSession(new AbortController().signal))
    .then(
      () => open.handle?.close(),
      (error: unknown) => {
        const failed = describeFailure(error, SCHEDULE_PATHS)

        form.failure.value = failed.top
        form.fields.value = failed.fields
      }
    )
    .finally(() => {
      form.isBusy.value = false
    })
}
