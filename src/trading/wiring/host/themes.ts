import type { TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import { scoped } from '@/trading/wiring/host/scope'

const LINE_BREAK = '\n'

export type ThemeMethods = Pick<TradingHost, 'readThemes' | 'changeTheme'>

/** The operator's theme list as `/themes show` reads it, and the moves `/themes` makes on it. */
export function themeMethods(deps: TradingHostDeps): ThemeMethods {
  return {
    readThemes: (request) =>
      scoped(deps, request.signal, async (scope) => {
        const view = await deps.services.appViews.themes({
          locale: request.locale,
          signal: scope.signal,
        })

        return { themes: view.themes, text: view.text.split(LINE_BREAK) }
      }),

    changeTheme: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.appViews.changeTheme({ ...request, now: scope.now, signal: scope.signal })
      ),
  }
}
