import type { ThemesResponse, ThemeTransitionResult } from '@/app/server/wire/themes'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { apiError, json } from '@/app/server/http/dispatch'
import { hostOf, localeOf, parseOneOf, parsePathId } from '@/app/server/routes/params'
import { renderMessages } from '@/commands/api'
import { bindLocale } from '@/i18n'
import { THEME_TRANSITIONS, themeId } from '@/trading/api'

async function handleThemes(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const view = await hostOf(ctx).readThemes({ locale: localeOf(ctx), signal: req.signal })

  return json({
    themes: view.themes.map((theme) => ({
      id: theme.id,
      title: theme.title,
      status: theme.status,
      maturity: theme.maturity,
    })),
    text: view.text,
  } satisfies ThemesResponse)
}

/** `/themes approve|reject|retire <id>`: a move the theme's status refuses is a conflict, with the
 *  same sentence the command answers. */
async function handleThemeTransition(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, themeId, 1)
  const transition = parseOneOf(parsePathId(req, String), THEME_TRANSITIONS)

  if (id === null || transition === null) {
    return apiError('invalid_body')
  }

  const change = await hostOf(ctx).changeTheme({ themeId: id, transition, signal: req.signal })
  const text = renderMessages(bindLocale(localeOf(ctx)), {
    kind: 'message',
    messages: [change.message],
  })

  if (change.kind === 'not-found') {
    return apiError('not_found', text)
  }

  if (change.kind === 'not-allowed') {
    return apiError('conflict', text)
  }

  return json({ text } satisfies ThemeTransitionResult)
}

export const THEME_ROUTES = [
  { method: 'GET', path: '/v1/themes', auth: true, handler: handleThemes },
  {
    method: 'POST',
    path: '/v1/themes/:id/:transition',
    auth: true,
    handler: handleThemeTransition,
  },
] as const satisfies readonly ApiRouteSpec[]
