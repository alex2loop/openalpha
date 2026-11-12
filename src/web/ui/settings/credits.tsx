import type { MessageKey } from '@/i18n'
import { isAnalysisOnly } from '@/web/state/edition'
import { tr } from '@/web/text/tr'
import {
  commonsPageUrl,
  LUCIDE_CREDIT,
  OPEN_METEO_CREDIT,
  OPENSTREETMAP_CREDIT,
  PHOTO_CREDITS,
  type SourceCredit,
} from '@/web/ui/settings/credits-data'

interface SourceUse {
  readonly credit: SourceCredit
  readonly use: MessageKey
}

const MAP: SourceUse = { credit: OPENSTREETMAP_CREDIT, use: 'ui.office.credits.osmUse' }
const WEATHER: SourceUse = { credit: OPEN_METEO_CREDIT, use: 'ui.office.weather.attribution' }
const ICONS: SourceUse = { credit: LUCIDE_CREDIT, use: 'ui.office.credits.iconsUse' }

/** Ghi công: every source the office page draws from or reads, with its license and a link. The web
 *  edition has no weather feed, so it reads and credits nothing of Open-Meteo. */
export function Credits() {
  const sources = isAnalysisOnly.value ? [MAP, ICONS] : [MAP, WEATHER, ICONS]

  return (
    <section class="setting-row">
      <h3 class="setting-title">{tr('ui.office.credits.title')}</h3>
      <p class="meta">{tr('ui.office.credits.note')}</p>
      {sources.map(({ credit, use }) => (
        <div key={credit.name} class="setting-job">
          <a href={credit.url} target="_blank" rel="noopener noreferrer">
            <b>{credit.name}</b>
          </a>
          <p class="meta">
            {credit.licence} - {tr(use)}
          </p>
        </div>
      ))}
      <div class="setting-job">
        <b>{tr('ui.office.credits.photos')}</b>
        <p class="meta">{tr('ui.office.credits.photosNote')}</p>
        {PHOTO_CREDITS.map(({ author, licence, pages }) => (
          <p key={`${author}:${licence}`} class="meta">
            {author} - {licence}
            {pages.map((id, index) => (
              <>
                {' '}
                <a
                  key={id}
                  href={commonsPageUrl(id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={tr('ui.office.credits.photoLink', { n: index + 1 })}
                >
                  {index + 1}
                </a>
              </>
            ))}
          </p>
        ))}
      </div>
    </section>
  )
}
