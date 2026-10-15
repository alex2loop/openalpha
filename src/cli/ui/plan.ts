import type { Locale } from '@/core/types/locale'
import type { TodoStep } from '@/engine/api'
import { colors } from '@/cli/ui/colors'
import { sanitizeDisplayText } from '@/core/utils/text'
import { TODO_GLYPHS, toPlanSteps } from '@/engine/api'
import { t } from '@/i18n'

const STEP_INDENT = '   '

interface PlanUpdate {
  /** The block to print, present only for a plan the reader has not seen yet. */
  readonly block?: string
}

interface PlanView {
  /** Absorbs a plan summary. Undefined means it was not a plan, so the caller renders it normally. */
  update(label: string, summary: string): PlanUpdate | undefined
  /** Counter and running step for the spinner; undefined while no step is running. */
  status(): string | undefined
  /** Reports an abandoned plan once, at turn end. A finished one needs no epilogue. */
  close(): string | undefined
}

/** The plan is stated once and never restated: only its progress changes, and progress belongs on
 *  the spinner, which repaints. Reprinting the list per update buried the work lines between copies
 *  of a list whose one changed line the reader then had to find. */
export function createPlanView(locale: Locale): PlanView {
  let label = ''
  let steps: readonly TodoStep[] = []

  return {
    update(nextLabel, summary): PlanUpdate | undefined {
      const parsed = toPlanSteps(summary)

      if (parsed === undefined) {
        return undefined
      }

      // A replan — different steps, not merely different statuses — is a new plan to state.
      const restated = identityOf(parsed) !== identityOf(steps)
      const revised = steps.length > 0
      label = nextLabel
      steps = parsed

      if (!restated) {
        return {}
      }

      return {
        block: formatPlanBlock(
          revised ? revisedLabel(locale, nextLabel) : nextLabel,
          parsed,
          revised
        ),
      }
    },

    status(): string | undefined {
      const active = steps.find((step) => step.status === 'in_progress')

      if (active === undefined) {
        return undefined
      }

      return `${countCompleted(steps)}/${steps.length} · ${sanitizeDisplayText(active.text)}`
    },

    close(): string | undefined {
      const total = steps.length
      const completed = countCompleted(steps)
      // Cleared on every path, so the next turn's first plan is not diffed against this one.
      steps = []

      if (total === 0 || completed === total) {
        return undefined
      }

      return colors.dim(`${label}: ${t(locale, 'ui.planStopped', { completed, total })}`)
    },
  }
}

/** A revision prints mid-flight, where plain numbers show finished work as untouched and read as
 *  if the run had restarted. The first statement precedes every step, so it stays unmarked. */
function formatPlanBlock(label: string, steps: readonly TodoStep[], revised: boolean): string {
  const width = String(steps.length).length
  const lines = steps.map((step, index) => {
    const marker = revised ? `${TODO_GLYPHS[step.status]} ` : ''

    return `${STEP_INDENT}${marker}${String(index + 1).padStart(width)}. ${sanitizeDisplayText(step.text)}`
  })

  return ['', colors.bold(label), ...lines, ''].join('\n')
}

function revisedLabel(locale: Locale, label: string): string {
  return `${label} (${t(locale, 'ui.planRevised')})`
}

function identityOf(steps: readonly TodoStep[]): string {
  return steps.map((step) => step.text).join('\n')
}

function countCompleted(steps: readonly TodoStep[]): number {
  return steps.filter((step) => step.status === 'completed').length
}
