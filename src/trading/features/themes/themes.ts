import type { ThemeRunDeps } from '@/trading/features/themes/run'
import type { ThemeStore } from '@/trading/features/themes/store'
import type {
  ThemeService,
  ThemeTransitionOutcome,
  ThemeTransitionRequest,
} from '@/trading/features/themes/types'
import { resolveDueOutcomes } from '@/trading/features/themes/outcomes/resolve'
import { loadThemeReport, runThemes } from '@/trading/features/themes/run'
import { THEME_TRANSITION_RULES } from '@/trading/features/themes/types'

function transitionTheme(
  store: ThemeStore,
  request: ThemeTransitionRequest
): Promise<ThemeTransitionOutcome> {
  const rule = THEME_TRANSITION_RULES[request.action]

  return store.transition({
    id: request.id,
    from: rule.from,
    to: rule.to,
    now: request.now,
    signal: request.signal,
  })
}

/** One run at a time per process: a second `/themes` while one reads would bill the same bundle
 *  twice and race the same rows. */
export function createThemeService(deps: ThemeRunDeps): ThemeService {
  let running = false

  return {
    run: async (request) => {
      if (running) {
        return { kind: 'busy' }
      }

      running = true

      try {
        const failure = await runThemes(deps, request)

        return (
          failure ?? { kind: 'report', report: await loadThemeReport(deps.store, request.signal) }
        )
      } finally {
        running = false
      }
    },
    show: (signal) => loadThemeReport(deps.store, signal),
    transition: (request) => transitionTheme(deps.store, request),
    resolveOutcomes: (options) =>
      resolveDueOutcomes(
        { store: deps.store, marketData: deps.chain.marketData, today: deps.today },
        options
      ),
  }
}
