import type { AgentForm } from '@/web/ui/agent/form/form-state'
import { RAMP } from '@/web/scene/sprites/palette'
import { LOOK_PARTS, type LookPart, lookOf } from '@/web/scene/sprites/parts'
import { tr } from '@/web/text/tr'
import { resolveAgentId } from '@/web/ui/agent/form/form-state'
import { FieldNote } from '@/web/ui/dialogs/field-note'
import { Portrait } from '@/web/ui/kit/portrait'

const LOOK_PORTRAIT_PX = 96
const LOOK_PATH = 'look'

interface PartOption {
  readonly value: string
  readonly label: string
  /** A colour part shows a swatch with its name for screen readers and the tooltip. */
  readonly swatch?: string
}

interface PartRow {
  readonly part: LookPart
  readonly label: string
  readonly options: readonly PartOption[]
}

/** The paths a refused look comes back under: the whole look, or one part of it. */
export const LOOK_PATHS: readonly string[] = [
  LOOK_PATH,
  ...Object.keys(LOOK_PARTS).map((part) => `${LOOK_PATH}.${part}`),
]

/** Ngoại hình: body, hair, shirt and accessory, with the portrait following each pick. A part
 *  left unpicked is the one the agent's id gives it. */
export function LookPicker({ form }: { readonly form: AgentForm }) {
  const look = lookOf(resolveAgentId(form), undefined, form.look.value)
  const picked: Readonly<Record<LookPart, string>> = look

  return (
    <fieldset class="form-field">
      <legend class="form-label">{tr('ui.office.form.look')}</legend>
      <div class="look-picker">
        <Portrait look={look} size={LOOK_PORTRAIT_PX} />
        <div class="look-rows">
          {buildRows().map((row) => (
            <PartRowView key={row.part} row={row} picked={picked[row.part]} form={form} />
          ))}
        </div>
      </div>
      {LOOK_PATHS.map((path) => (
        <FieldNote key={path} message={form.fields.value.get(path)} />
      ))}
    </fieldset>
  )
}

function PartRowView({
  row,
  picked,
  form,
}: {
  readonly row: PartRow
  readonly picked: string
  readonly form: AgentForm
}) {
  return (
    <fieldset class="look-row">
      <legend class="look-row-label">{row.label}</legend>
      <div class="form-pills">
        {row.options.map((option) => (
          <button
            key={option.value}
            type="button"
            class={`${option.swatch === undefined ? 'form-pill' : 'look-swatch'}${option.value === picked ? ' is-on' : ''}`}
            style={option.swatch === undefined ? undefined : { background: option.swatch }}
            title={option.label}
            aria-label={option.label}
            aria-pressed={option.value === picked}
            onClick={() => {
              form.look.value = { ...form.look.value, [row.part]: option.value }
            }}
          >
            {option.swatch === undefined ? option.label : null}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function buildRows(): readonly PartRow[] {
  return [
    {
      part: 'body',
      label: tr('ui.office.form.lookBody'),
      options: LOOK_PARTS.body.map((value) => ({
        value,
        label: tr(`ui.office.look.body.${value}`),
        swatch: RAMP.skin[value][1],
      })),
    },
    {
      part: 'hair',
      label: tr('ui.office.form.lookHair'),
      options: LOOK_PARTS.hair.map((value) => ({
        value,
        label: tr(`ui.office.look.hair.${value}`),
      })),
    },
    {
      part: 'shirt',
      label: tr('ui.office.form.lookShirt'),
      options: LOOK_PARTS.shirt.map((value) => ({
        value,
        label: tr(`ui.office.look.shirt.${value}`),
        swatch: RAMP.shirt[value][1],
      })),
    },
    {
      part: 'prop',
      label: tr('ui.office.form.lookProp'),
      options: LOOK_PARTS.prop.map((value) => ({
        value,
        label: tr(`ui.office.look.prop.${value}`),
      })),
    },
  ]
}
