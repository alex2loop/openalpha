import type { Locale } from '@/core/types/locale'
import type { Runner } from '@/engine/api'
import { renderAiLabel } from '@/i18n'

/** An agent's reply on the page ends with the line saying an AI wrote it and can be wrong, naming
 *  the model where one served every call of the session. It rides the reply's own stream, after the
 *  last word, so the page shows it as part of the answer. A run that did not answer gets none. */
export function createLabelledRunner(runner: Runner, locale: Locale): Runner {
  return {
    async run(input, options) {
      const result = await runner.run(input, options)

      if (result.reason === 'completed' && result.text !== '') {
        const { modelName } = result.totals
        const label = renderAiLabel(locale, modelName === undefined ? [] : [modelName])

        input.onChunk?.({ type: 'text_delta', delta: `\n\n${label}` })
      }

      return result
    },
  }
}
