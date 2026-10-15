import type { StreamPrinter } from '@/cli/commands/chat/render'
import type { CliApp } from '@/cli/types'
import type { PromptFn } from '@/cli/ui/prompt'
import type {
  ForegroundResearchInteraction,
  ResearchProgress,
  ReviewResearchPlan,
} from '@/engine/api'
import { createCliPlanReviewer } from '@/cli/research/plan-review'
import {
  createResearchProgressRenderer,
  type ResearchProgressRenderer,
  resolveResearchVerbosity,
} from '@/cli/research/progress'
import { sanitizeDisplayText } from '@/core/utils/text'

interface CliResearchInteractionDeps {
  readonly app: CliApp
  readonly printer: StreamPrinter
  readonly signal: AbortSignal
  readonly prompt?: PromptFn
}

// The terminal has one owner per moment: while research renders, the turn printer stays paused;
// finish() hands it back. A later research call in the same turn starts a fresh renderer.
export function createCliResearchInteraction(
  deps: CliResearchInteractionDeps
): ForegroundResearchInteraction {
  let renderer: ResearchProgressRenderer | undefined

  const start = (): ResearchProgressRenderer => {
    deps.printer.pause()

    return createResearchProgressRenderer({
      output: { writeRaw: deps.app.write, writeLine: deps.app.out },
      locale: deps.app.config.locale.language,
      verbosity: resolveResearchVerbosity('text'),
    })
  }
  const reviewPlan = resolveReviewPlan(deps, () => renderer)

  return {
    reportProgress(message: ResearchProgress): void {
      renderer ??= start()
      renderer.report(message)
    },
    ...(reviewPlan === undefined ? {} : { reviewPlan }),
    finish(): void {
      const active = renderer

      if (active === undefined) {
        return
      }

      renderer = undefined
      active.close()
      deps.printer.resume()
    },
  }
}

function resolveReviewPlan(
  deps: CliResearchInteractionDeps,
  current: () => ResearchProgressRenderer | undefined
): ReviewResearchPlan | undefined {
  const { prompt } = deps

  if (prompt === undefined || deps.signal.aborted) {
    return undefined
  }

  return createCliPlanReviewer({
    prompt,
    locale: deps.app.config.locale.language,
    write: (line) => deps.app.out(sanitizeDisplayText(line)),
    pause: () => current()?.pause(),
    resume: () => current()?.resume(),
  })
}
