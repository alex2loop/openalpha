import type { BriefScheduleWire } from '@/app/server/wire/system'
import type {
  BriefSectionWire,
  BriefSnapshotWire,
  BriefTextWire,
  ScreenDeltaRowWire,
} from '@/app/server/wire/trading'
import type { Locale } from '@/core/types/locale'
import type {
  BriefDelivery,
  BriefSectionResult,
  BriefSnapshot,
  BriefText,
  TradingBriefView,
} from '@/trading/api'
import { toCaveatWires, toProvenanceWires } from '@/app/server/mappers/trading'

export function toBriefSnapshotWire(
  view: TradingBriefView & {
    readonly snapshot: BriefSnapshot
  },
  locale: Locale
): BriefSnapshotWire {
  const { snapshot } = view

  return {
    id: snapshot.id,
    region: view.region,
    day: snapshot.asOf,
    authoredLocale: snapshot.authoredLocale,
    createdAt: snapshot.createdAt,
    sections: snapshot.sections.map((section) => toBriefSectionWire(section, locale)),
    caveats: toCaveatWires(snapshot.caveats, locale),
  }
}

function toBriefSectionWire(section: BriefSectionResult, locale: Locale): BriefSectionWire {
  const scope = {
    ...(section.market === undefined ? {} : { market: section.market }),
    ...(section.asOf === undefined ? {} : { asOf: section.asOf }),
  }

  if (section.status !== 'ready') {
    return {
      ...scope,
      kind: section.kind,
      status: section.status,
      caveats: toCaveatWires(section.caveats, locale),
    }
  }

  const sources = {
    provenance: toProvenanceWires(section.provenance),
    caveats: toCaveatWires(section.caveats, locale),
  }

  if (section.kind === 'screen-delta') {
    return {
      ...scope,
      kind: section.kind,
      status: 'ready',
      rows: toScreenDeltaRows(section),
      ...sources,
    }
  }

  return {
    ...scope,
    kind: section.kind,
    status: 'ready',
    rows: section.rows.map((row) => ({ ...row })),
    ...sources,
  }
}

/** A row without a ticker or a known direction is left out rather than guessed at. */
function toScreenDeltaRows(
  section: Extract<BriefSectionResult, { readonly status: 'ready' }>
): ScreenDeltaRowWire[] {
  return section.rows.flatMap((row) => {
    const { ticker, direction } = row

    return typeof ticker === 'string' && (direction === 'entered' || direction === 'left')
      ? [{ ticker, direction }]
      : []
  })
}

export function toBriefScheduleWire(delivery: BriefDelivery): BriefScheduleWire {
  return {
    state: delivery.state,
    channel: delivery.delivery.channel,
    ...(delivery.sendTime === undefined ? {} : { sendTime: delivery.sendTime }),
    ...(delivery.state === 'scheduled' ? { nextDeliveryDay: delivery.nextDeliveryDay } : {}),
  }
}

export function toBriefTextWire(text: BriefText): BriefTextWire {
  return {
    title: text.title,
    verdict: [...text.verdict],
    sections: text.sections.map((section) => ({ ...section, lines: [...section.lines] })),
    caveats: [...text.caveats],
  }
}
