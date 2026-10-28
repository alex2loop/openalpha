import type { ReaderContent } from '@/web/ui/reader/load-report'
import { pluralKey } from '@/i18n'
import { fillInput } from '@/web/state/command'
import { tr } from '@/web/text/tr'
import { ReportView } from '@/web/ui/markdown/markdown'
import { plainTextOf } from '@/web/ui/markdown/parse'
import { reportOutline } from '@/web/ui/reader/outline'
import { ReaderPage } from '@/web/ui/reader/page'

interface ReportPageProps {
  readonly content: Extract<ReaderContent, { readonly kind: 'report' }>
  readonly onClose: () => void
}

/** A model's report: its markdown, with the sources it names. */
export function ReportPage({ content, onClose }: ReportPageProps) {
  const { title, doc } = content
  const count = doc.sources.length

  return (
    <ReaderPage
      title={title}
      meta={
        count === 0
          ? undefined
          : tr(pluralKey(count, 'ui.office.common.sourcesOne', 'ui.office.common.sources'), {
              count,
            })
      }
      entries={reportOutline(doc)}
      plainText={plainTextOf(doc)}
      onClose={onClose}
      onAsk={(quote) => {
        onClose()
        fillInput(`${tr('ui.office.reader.quote', { quote, title })} `)
      }}
    >
      <ReportView doc={doc} isAnchored />
    </ReaderPage>
  )
}
