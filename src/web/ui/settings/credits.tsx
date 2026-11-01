import type { MessageKey } from '@/i18n'
import { tr } from '@/web/text/tr'
import {
  commonsPageUrl,
  LUCIDE_CREDIT,
  OPEN_METEO_CREDIT,
  OPENSTREETMAP_CREDIT,
  PHOTO_CREDITS,
  type SourceCredit,
} from '@/web/ui/settings/credits-data'

const SOURCES: readonly { readonly credit: SourceCredit; readonly use: MessageKey }[] = [
  { credit: OPENSTREETMAP_CREDIT, use: 'ui.office.credits.osmUse' },
  { credit: OPEN_METEO_CREDIT, use: 'ui.office.weather.attribution' },
  { credit: LUCIDE_CREDIT, use: 'ui.office.credits.iconsUse' },
]

/** Ghi công: every source the office page draws from or reads, with its licence and a link. */
export function Credits() {
  return (
    <section class="setting-row">
      <h3 class="setting-title">{tr('ui.office.credits.title')}</h3>
      <p class="meta">{tr('ui.office.credits.note')}</p>
      {SOURCES.map(({ credit, use }) => (
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
