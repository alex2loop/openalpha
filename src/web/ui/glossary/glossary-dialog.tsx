import { useSignal } from '@preact/signals'

import { foldGlossaryText, glossaryGroups, matchesGlossaryQuery } from '@/i18n'
import { locale } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { closeModal, openModal } from '@/web/ui/kit/modal'

import './glossary.css'

/** The glossary page: every term in its group, with a box that narrows them by name, ticker or what
 *  the definition says. Opened from a term's card, the guide and Hôm nay. */
export function openGlossary(): void {
  openModal({
    title: tr('ui.office.glossary.title'),
    wide: true,
    body: <GlossaryBody />,
    footer: <Button onClick={closeModal}>{tr('ui.office.common.close')}</Button>,
  })
}

function GlossaryBody() {
  const query = useSignal('')
  const isSearching = foldGlossaryText(query.value) !== ''
  const groups = glossaryGroups(locale.value)
    .map((group) => ({
      ...group,
      terms: group.terms.filter((term) =>
        matchesGlossaryQuery([term.name, term.definition, ...term.tickers], query.value)
      ),
    }))
    .filter((group) => group.terms.length > 0)

  return (
    <div class="glossary">
      <p class="meta">{tr('ui.office.glossary.intro')}</p>
      <input
        type="search"
        class="glossary-search"
        placeholder={tr('ui.office.glossary.search')}
        aria-label={tr('ui.office.glossary.search')}
        value={query.value}
        onInput={(event) => (query.value = event.currentTarget.value)}
      />
      {groups.length === 0 && <p class="empty-note">{tr('ui.office.glossary.empty')}</p>}
      {groups.map(({ group, title, about, terms }) => (
        <section key={group} class="glossary-group">
          <h3 class="glossary-title">{title}</h3>
          {isSearching ? null : <p class="meta">{about}</p>}
          <dl class="glossary-terms">
            {terms.map(({ id, name, definition }) => (
              <div key={id} class="glossary-term">
                <dt>{name}</dt>
                <dd>{definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
