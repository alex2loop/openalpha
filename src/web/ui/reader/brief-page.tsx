import { useEffect } from 'preact/hooks'

import type { BriefTextWire } from '@/app/server/wire/brief'
import type { ReaderContent } from '@/web/ui/reader/load-report'
import { BRIEF_COMMAND, BRIEF_NAME, FORCE_ARG } from '@/web/state/command'
import { onCommandFinished } from '@/web/state/events'
import { tr } from '@/web/text/tr'
import { RunButton } from '@/web/ui/command/run-button'
import { Fold } from '@/web/ui/kit/fold'
import { InlineMarkdown } from '@/web/ui/markdown/markdown'
import { NoteList } from '@/web/ui/markdown/report-notes'
import {
  briefOutline,
  CAUTIONS_ANCHOR,
  groupCautions,
  type SectionRow,
  type StoryBlock,
  type StoryLine,
  sectionAnchor,
  sectionRows,
  sectionTitle,
  storyBlocks,
} from '@/web/ui/reader/brief-model'
import { ReaderPage } from '@/web/ui/reader/page'

const REWRITE_COMMAND = `${BRIEF_COMMAND} ${FORCE_ARG}`

interface BriefPageProps {
  readonly content: Extract<ReaderContent, { readonly kind: 'brief' }>
  readonly onClose: () => void
  /** Reads the brief again, once a run has written a new one. */
  readonly onReload: () => void
}

/** The brief laid out by what each line is: the call and its figures first, then the story, each
 *  section, and the cautions. Its book sections hold amounts no model may see, so no passage of it
 *  can be quoted into a question. */
export function BriefPage({ content, onClose, onReload }: BriefPageProps) {
  const { title, meta, text } = content
  const blocks = storyBlocks(text.story)

  useEffect(() => onCommandFinished(BRIEF_NAME, onReload), [])

  return (
    <ReaderPage
      title={title}
      meta={meta}
      entries={briefOutline(text)}
      plainText={briefPlainText(text)}
      onClose={onClose}
    >
      <div class="flow reader-brief">
        <Verdict text={text} />
        {blocks.map((block) => (
          <Story key={block.id} block={block} />
        ))}
        {text.sections.map((section) => (
          <Section key={section.id} section={section} />
        ))}
        <Cautions caveats={text.caveats} />
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

function briefPlainText(text: BriefTextWire): string {
  return [
    ...text.verdict,
    ...text.story.map((line) => line.text),
    ...text.sections.flatMap((section) => section.lines),
  ].join('\n')
}

function Verdict({ text }: { readonly text: BriefTextWire }) {
  const reading = text.verdict.slice(0, text.readingLines)
  const figures = text.verdict.slice(text.readingLines)

  return (
    <>
      {reading.map((line) => (
        <p key={line} class="lead">
          <InlineMarkdown text={line} />
        </p>
      ))}
      <Figures lines={figures} />
    </>
  )
}

function Figures({ lines }: { readonly lines: readonly string[] }) {
  return (
    <div class="stack reader-figures">
      {lines.map((line, index) => (
        <p key={index} class="reader-figure">
          <InlineMarkdown text={line} />
        </p>
      ))}
    </div>
  )
}

function Story({ block }: { readonly block: StoryBlock }) {
  return (
    <>
      {block.title !== undefined && <SubHead id={block.id} text={block.title} />}
      {block.parts.map((part, index) =>
        part.kind === 'lead' ? (
          <p key={index} class="lead">
            <InlineMarkdown text={part.text} />
          </p>
        ) : (
          <div key={index} class="stack reader-figures">
            {part.heading !== undefined && <h4 class="reader-group-head">{part.heading}</h4>}
            {part.lines.map((line, at) => (
              <StoryLineView key={at} line={line} />
            ))}
          </div>
        )
      )}
    </>
  )
}

const LINE_CLASSES = { note: 'reader-note', source: 'meta' } as const

function StoryLineView({ line }: { readonly line: StoryLine }) {
  const className =
    line.role === 'note' || line.role === 'source' ? LINE_CLASSES[line.role] : 'reader-figure'

  return (
    <p class={className}>
      <InlineMarkdown text={line.text} />
    </p>
  )
}

function Section({ section }: { readonly section: BriefTextWire['sections'][number] }) {
  return (
    <>
      <SubHead id={sectionAnchor(section)} text={sectionTitle(section)} />
      <div class="stack reader-figures">
        {sectionRows(section).map((row, index) => (
          <SectionRowView key={index} row={row} />
        ))}
      </div>
    </>
  )
}

function SectionRowView({ row }: { readonly row: SectionRow }) {
  return (
    <>
      <p class="reader-figure">
        <InlineMarkdown text={row.text} />
      </p>
      {row.details.length > 0 && (
        <div class="stack reader-figures reader-details">
          {row.details.map((detail, index) => (
            <p key={index} class="reader-figure">
              <InlineMarkdown text={detail} />
            </p>
          ))}
        </div>
      )}
    </>
  )
}

function Cautions({ caveats }: { readonly caveats: readonly string[] }) {
  const { warnings, methodology } = groupCautions(caveats)

  if (caveats.length === 0) {
    return null
  }

  return (
    <>
      <SubHead id={CAUTIONS_ANCHOR} text={tr('ui.office.reader.cautions')} />
      {warnings.length > 0 && (
        <ul class="stack reader-cautions">
          {warnings.map((warning) => (
            <li key={warning}>
              <InlineMarkdown text={warning} />
            </li>
          ))}
        </ul>
      )}
      {methodology !== undefined && (
        <Fold title={methodology.title}>
          <NoteList lines={methodology.lines} />
        </Fold>
      )}
    </>
  )
}

function SubHead({ id, text }: { readonly id: string; readonly text: string }) {
  return (
    <h3 class="sub-head" id={id} tabIndex={-1}>
      {text}
    </h3>
  )
}
