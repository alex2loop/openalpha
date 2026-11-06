import type { PublicBriefDocument, PublicScreenWire } from '@/app/server/wire/public-brief'
import type { PublicBriefRender, PublicScreenText } from '@/trading/api'
import { toBriefTextWire } from '@/app/server/mappers/brief'
import { PUBLIC_BRIEF_SCHEMA } from '@/trading/api'

export function toPublicBriefDocument(render: PublicBriefRender): PublicBriefDocument {
  return {
    schema: PUBLIC_BRIEF_SCHEMA,
    day: render.day,
    builtAt: render.builtAt,
    briefs: { vi: toBriefTextWire(render.texts.vi), en: toBriefTextWire(render.texts.en) },
    screens: {
      vi: render.screens.vi.map(toPublicScreenWire),
      en: render.screens.en.map(toPublicScreenWire),
    },
    headline: render.headline,
    disclaimer: render.disclaimer,
  }
}

function toPublicScreenWire(screen: PublicScreenText): PublicScreenWire {
  return {
    market: screen.market,
    title: screen.title,
    asOf: screen.asOf,
    rows: screen.rows.map(({ ticker, line }) => ({ ticker, line })),
    note: screen.note,
  }
}
