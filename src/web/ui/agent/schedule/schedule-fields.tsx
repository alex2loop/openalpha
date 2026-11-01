import { tr } from '@/web/text/tr'
import {
  EVENT_COOLDOWNS,
  EVENT_KINDS,
  type EventKind,
  REPEAT_LABELS,
  type Repeat,
  type ScheduleForm,
} from '@/web/ui/agent/schedule/schedule-state'
import { FieldNote } from '@/web/ui/dialogs/field-note'
import { IDENTIFIER_INPUT } from '@/web/ui/kit/identifier-input'

const REPEATS: readonly Repeat[] = ['daily', 'weekly', 'once']

interface FieldsProps {
  readonly form: ScheduleForm
}

/** "Chạy lúc" and "Lặp lại". */
export function TimeFields({ form }: FieldsProps) {
  return (
    <div class="form-row">
      <label class="form-field form-label">
        {tr('ui.office.schedule.runAt')}
        <input
          type="time"
          value={form.runAt.value}
          onInput={(event) => {
            form.runAt.value = event.currentTarget.value
          }}
        />
      </label>
      <label class="form-field form-label">
        {tr('ui.office.schedule.repeat')}
        <select
          value={form.repeat.value}
          onChange={(event) => {
            form.repeat.value = toRepeat(event.currentTarget.value)
          }}
        >
          {REPEATS.map((repeat) => (
            <option key={repeat} value={repeat}>
              {tr(REPEAT_LABELS[repeat])}
            </option>
          ))}
        </select>
      </label>
      <FieldNote
        message={form.fields.value.get('schedule.expr') ?? form.fields.value.get('schedule.at')}
      />
    </div>
  )
}

/** "Khi" which event, for which name, at which level for a price, and how long it rests after. */
export function EventFields({ form }: FieldsProps) {
  return (
    <>
      <label class="form-field form-label">
        {tr('ui.office.schedule.when')}
        <select
          value={form.event.value}
          onChange={(event) => {
            form.event.value = toEventKind(event.currentTarget.value)
          }}
        >
          {EVENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {tr(`scheduler.event.${kind}`)}
            </option>
          ))}
        </select>
      </label>
      <label class="form-field form-label">
        {tr('ui.office.schedule.ticker')}
        <input
          type="text"
          class="mono"
          {...IDENTIFIER_INPUT}
          value={form.ticker.value}
          onInput={(event) => {
            form.ticker.value = event.currentTarget.value
          }}
        />
      </label>
      {form.event.value === 'price' && <LevelField form={form} />}
      <CooldownField form={form} />
    </>
  )
}

function LevelField({ form }: FieldsProps) {
  return (
    <label class="form-field form-label">
      {tr('ui.office.common.priceLevel')}
      <input
        type="text"
        inputMode="decimal"
        class="form-number"
        value={form.level.value}
        onInput={(event) => {
          form.level.value = event.currentTarget.value
        }}
      />
      <FieldNote message={form.fields.value.get('schedule.threshold')} />
    </label>
  )
}

function CooldownField({ form }: FieldsProps) {
  return (
    <label class="form-field form-label">
      {tr('ui.office.schedule.cooldown')}
      <select
        value={String(form.cooldownMs.value)}
        onChange={(event) => {
          form.cooldownMs.value = Number(event.currentTarget.value)
        }}
      >
        {EVENT_COOLDOWNS.map((cooldown) => (
          <option key={cooldown.ms} value={String(cooldown.ms)}>
            {tr(cooldown.label)}
          </option>
        ))}
      </select>
      <FieldNote message={form.fields.value.get('schedule.cooldownMs')} />
    </label>
  )
}

function toRepeat(value: string): Repeat {
  return REPEATS.find((repeat) => repeat === value) ?? 'daily'
}

function toEventKind(value: string): EventKind {
  return EVENT_KINDS.find((kind) => kind === value) ?? 'stop'
}
