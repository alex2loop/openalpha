import { useEffect } from 'preact/hooks'

import { type FeatureId, WEB_FEATURES } from '@/web/edition/guide/features'
import { INSTALL_URL } from '@/web/edition/guide/product'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { closeModal, openModal } from '@/web/ui/kit/modal'
import { jumpTo } from '@/web/ui/markdown/markdown'

import './guide.css'

type Feature = (typeof WEB_FEATURES)[number]

/** "Bản web và bản cài": every job in `WEB_FEATURES` with what the web edition does, what the
 *  installed version does and, where the web stops short, the one plain reason. `row` scrolls to the
 *  job an install line came from. */
export function openCompare(row?: FeatureId): void {
  openModal({
    title: tr('ui.office.edition.compare.title'),
    wide: true,
    body: <CompareBody row={row} />,
    footer: <Button onClick={closeModal}>{tr('ui.office.common.close')}</Button>,
  })
}

function CompareBody({ row }: { readonly row: FeatureId | undefined }) {
  useEffect(() => {
    if (row !== undefined) {
      jumpTo(rowAnchor(row))
    }
  }, [row])

  return (
    <div class="compare">
      <p>{tr('ui.office.edition.compare.intro')}</p>
      {WEB_FEATURES.map((feature) => (
        <FeatureRow key={feature.id} feature={feature} />
      ))}
      <p class="meta">{tr('ui.office.edition.compare.risk')}</p>
      <section class="compare-install">
        <h3>{tr('ui.office.edition.compare.install.title')}</h3>
        <p>{tr('ui.office.edition.compare.install.body')}</p>
        <a
          class="btn btn-commit btn-regular"
          href={INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {tr('ui.office.edition.compare.install.cta')}
        </a>
      </section>
    </div>
  )
}

function FeatureRow({ feature }: { readonly feature: Feature }) {
  const { id } = feature

  return (
    <article id={rowAnchor(id)} class="compare-row" tabIndex={-1}>
      <header class="compare-head">
        <h3>{tr(`ui.office.edition.compare.${id}.label`)}</h3>
        <span class="chip">{tr(`ui.office.edition.compare.status.${feature.web}`)}</span>
      </header>
      <div class="compare-cols">
        <div>
          <h4>{tr('ui.office.edition.compare.column.web')}</h4>
          <p>{tr(`ui.office.edition.compare.${id}.web`)}</p>
        </div>
        <div>
          <h4>{tr('ui.office.edition.compare.column.installed')}</h4>
          <p>{tr(`ui.office.edition.compare.${id}.installed`)}</p>
        </div>
      </div>
      {'reason' in feature && <p class="meta">{tr(feature.reason)}</p>}
    </article>
  )
}

function rowAnchor(id: FeatureId): string {
  return `compare-${id}`
}
