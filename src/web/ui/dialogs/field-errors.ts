import { ApiFailure } from '@/web/api/client'
import { toErrorText } from '@/web/text/tr'

/** Where a refusal of the whole body sits in `ApiFailure.fields`: no field. */
const WHOLE_BODY_PATH = ''

/** A refused save as a dialog shows it: the daemon's sentence under each field it named, and the
 *  rest at the top. */
export interface FormFailure {
  readonly top: string | undefined
  readonly fields: ReadonlyMap<string, string>
}

/** The daemon's sentence for each field it refused, by the path it named in the body sent
 *  (`quantity`, `instrument.ticker`). */
function fieldMessages(failure: ApiFailure): ReadonlyMap<string, string> {
  return new Map(failure.fields.map((field) => [field.path, field.message]))
}

/** Splits a failed save for the dialog: `shown` lists the paths it has a field for. A sentence for
 *  a path it does not show, and a refusal of the whole body, go to the top with any other failure,
 *  so no refusal is lost. */
export function describeFailure(error: unknown, shown: readonly string[]): FormFailure {
  if (!(error instanceof ApiFailure) || error.fields.length === 0) {
    return { top: toErrorText(error), fields: new Map() }
  }

  const all = fieldMessages(error)
  const fields = new Map([...all].filter(([path]) => shown.includes(path)))
  const unplaced = [...all].filter(([path]) => path === WHOLE_BODY_PATH || !shown.includes(path))

  return {
    top: unplaced.length === 0 ? undefined : unplaced.map(([, message]) => message).join(' '),
    fields,
  }
}
