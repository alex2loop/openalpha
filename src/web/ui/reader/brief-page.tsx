import { useEffect } from 'preact/hooks'

import type { BriefTextWire } from '@/app/server/wire/brief'
import type { ReaderContent } from '@/web/ui/reader/load-report'
import { BRIEF_COMMAND, BRIEF_NAME, FORCE_ARG } from '@/web/state/command'
import { onCommandFinished } from '@/web/state/events'
import { tr } from '@/web/text/tr'
import { RunButton } from '@/web/ui/command/run-button'
import { AiLabel } from '@/web/ui/kit/ai-label'
import { BriefBody } from '@/web/ui/reader/brief-body'
import { briefOutline } from '@/web/ui/reader/brief-outline'
import { ReaderPage } from '@/web/ui/reader/page'
import { renderLinkedText } from '@/web/ui/ticker/linked-text'

const REWRITE_COMMAND = `${BRIEF_COMMAND} ${FORCE_ARG}`
// How a command run that threw ends.
const FAILED_OUTCOME = 'error'

interface BriefPageProps {
  readonly content: Extract<ReaderContent, { readonly kind: 'brief' }>
  readonly onClose: () => void
  /** Reads the brief again, once a run has written a new one. */
  readonly onReload: () => void
}

/** The brief in the reader's frame. Its book sections hold amounts no model may see, so no passage
 *  of it can be quoted into a question. */
export function BriefPage({ content, onClose, onReload }: BriefPageProps) {
  const { title, meta, text } = content

  useReloadOnRewrite(onReload)

  return (
    <ReaderPage
      title={title}
      meta={meta}
      entries={briefOutline(text)}
      plainText={briefPlainText(text)}
      onClose={onClose}
    >
      <div class="flow reader-brief">
        {text.aiGenerated !== false && <AiLabel />}
        <BriefBody
          text={text}
          labels={{ cautions: tr('ui.office.reader.cautions') }}
          renderText={renderLinkedText}
        />
        <div class="reader-next">
          <RunButton
            command={REWRITE_COMMAND}
            label={tr('ui.office.reader.briefRewrite')}
            busyLabel={tr('ui.office.reader.briefRewriting')}
            kind="ai"
            size="small"
            isQuiet
          />
        </div>
      </div>
    </ReaderPage>
  )
}

// A failed run wrote no brief, and reading again would take away the button that says why.
function useReloadOnRewrite(onReload: () => void): void {
  useEffect(
    () =>
      onCommandFinished(BRIEF_NAME, (outcome) => {
        if (outcome !== FAILED_OUTCOME) {
          onReload()
        }
      }),
    []
  )
}

function briefPlainText(text: BriefTextWire): string {
  return [
    ...(text.strip ?? []),
    ...text.story.map((line) => line.text),
    ...text.verdict,
    ...(text.nextActions ?? []),
    ...text.sections.flatMap((section) => section.lines),
  ].join('\n')
}
