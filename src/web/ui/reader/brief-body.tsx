import type { BriefTextWire } from '@/app/server/wire/brief'
import { Fold } from '@/web/ui/kit/fold'
import { SectionHeading } from '@/web/ui/kit/section-heading'
import { InlineText, type TextRenderer } from '@/web/ui/markdown/inline-view'
import { NoteList } from '@/web/ui/markdown/note-list'
import {
  blockAnchor,
  CAUTIONS_ANCHOR,
  groupCautions,
  type SectionBlock,
  type SectionRow,
  type StoryBlock,
  type StoryLine,
  sectionAnchor,
  sectionBlocks,
  sectionRows,
  sectionTitle,
  storyBlocks,
  VERDICT_ANCHOR,
} from '@/web/ui/reader/brief-model'

import './brief-body.css'

const LINE_CLASSES = { note: 'reader-note', source: 'meta' } as const

interface BriefBodyProps {
  readonly text: BriefTextWire
  readonly labels: { readonly cautions: string }
  readonly renderText?: TextRenderer | undefined
}

interface Rendering {
  readonly renderText?: TextRenderer | undefined
}

/** The brief laid out by what each line is: the day's headline figures, the call and its figures,
 *  then the story, each section, and the cautions. */
export function BriefBody({ text, labels, renderText }: BriefBodyProps) {
  return (
    <>
      <Strip cells={text.strip ?? []} renderText={renderText} />
      {storyBlocks(text.story).map((block) => (
        <Story key={block.id} block={block} renderText={renderText} />
      ))}
      <Verdict text={text} renderText={renderText} />
      {sectionBlocks(text.sections).map((block, index) => (
        <Block
          key={blockAnchor(index)}
          id={blockAnchor(index)}
          block={block}
          renderText={renderText}
        />
      ))}
      <Cautions caveats={text.caveats} title={labels.cautions} renderText={renderText} />
    </>
  )
}

function Strip({ cells, renderText }: Rendering & { readonly cells: readonly string[] }) {
  if (cells.length === 0) {
    return null
  }

  return (
    <div class="reader-strip">
      {cells.map((cell) => (
        <p key={cell} class="reader-strip-cell">
          <InlineText text={cell} renderText={renderText} />
        </p>
      ))}
    </div>
  )
}

function Verdict({ text, renderText }: Rendering & { readonly text: BriefTextWire }) {
  const reading = text.verdict.slice(0, text.readingLines)
  const figures = text.verdict.slice(text.readingLines)

  return (
    <>
      {text.verdictTitle !== undefined && <SubHead id={VERDICT_ANCHOR} text={text.verdictTitle} />}
      {reading.map((line) => (
        <p key={line} class="lead">
          <InlineText text={line} renderText={renderText} />
        </p>
      ))}
      <Figures lines={figures} renderText={renderText} />
      {(text.nextActions?.length ?? 0) > 0 && (
        <Figures lines={text.nextActions ?? []} renderText={renderText} />
      )}
    </>
  )
}

function Figures({ lines, renderText }: Rendering & { readonly lines: readonly string[] }) {
  return (
    <div class="stack reader-figures">
      {lines.map((line, index) => (
        <p key={index} class="reader-figure">
          <InlineText text={line} renderText={renderText} />
        </p>
      ))}
    </div>
  )
}

function Story({ block, renderText }: Rendering & { readonly block: StoryBlock }) {
  return (
    <>
      {block.title !== undefined && <SubHead id={block.id} text={block.title} />}
      {block.parts.map((part, index) =>
        part.kind === 'lead' ? (
          <p key={index} class="lead">
            <InlineText text={part.text} renderText={renderText} />
          </p>
        ) : (
          <div key={index} class="stack reader-figures">
            {part.heading !== undefined && (
              <h4 class="reader-group-head">
                <SectionHeading text={part.heading} />
              </h4>
            )}
            {part.lines.map((line, at) => (
              <StoryLineView key={at} line={line} renderText={renderText} />
            ))}
          </div>
        )
      )}
    </>
  )
}

function StoryLineView({ line, renderText }: Rendering & { readonly line: StoryLine }) {
  const className =
    line.role === 'note' || line.role === 'source' ? LINE_CLASSES[line.role] : 'reader-figure'

  return (
    <p class={className}>
      <InlineText text={line.text} renderText={renderText} />
    </p>
  )
}

/** A block as the CLI prints it: its heading, then each section under its own smaller heading. A
 *  block from a daemon that names none is a lone section under its full title. */
function Block({
  id,
  block,
  renderText,
}: Rendering & { readonly id: string; readonly block: SectionBlock }) {
  if (block.title === undefined) {
    return (
      <>
        {block.sections.map((section) => (
          <div key={section.id}>
            <SubHead id={sectionAnchor(section)} text={sectionTitle(section)} />
            <SectionRows section={section} renderText={renderText} />
          </div>
        ))}
      </>
    )
  }

  return (
    <>
      <SubHead id={id} text={block.title} />
      {block.sections.map((section) => (
        <Section key={section.id} section={section} renderText={renderText} />
      ))}
    </>
  )
}

function Section({
  section,
  renderText,
}: Rendering & { readonly section: BriefTextWire['sections'][number] }) {
  if (section.folded === true) {
    return (
      <div id={sectionAnchor(section)} tabIndex={-1}>
        <Fold title={section.heading}>
          <SectionRows section={section} renderText={renderText} />
        </Fold>
      </div>
    )
  }

  return (
    <>
      <h4 class="reader-group-head" id={sectionAnchor(section)} tabIndex={-1}>
        <SectionHeading text={section.heading} />
      </h4>
      <SectionRows section={section} renderText={renderText} />
    </>
  )
}

function SectionRows({
  section,
  renderText,
}: Rendering & { readonly section: BriefTextWire['sections'][number] }) {
  return (
    <div class="stack reader-figures">
      {sectionRows(section).map((row, index) => (
        <SectionRowView key={index} row={row} renderText={renderText} />
      ))}
    </div>
  )
}

function SectionRowView({ row, renderText }: Rendering & { readonly row: SectionRow }) {
  return (
    <>
      <p class="reader-figure">
        <InlineText text={row.text} renderText={renderText} />
      </p>
      {row.details.length > 0 && (
        <div class="stack reader-figures reader-details">
          {row.details.map((detail, index) => (
            <p key={index} class="reader-figure">
              <InlineText text={detail} renderText={renderText} />
            </p>
          ))}
        </div>
      )}
    </>
  )
}

function Cautions({
  caveats,
  title,
  renderText,
}: Rendering & { readonly caveats: readonly string[]; readonly title: string }) {
  const { warnings, methodology } = groupCautions(caveats)

  if (caveats.length === 0) {
    return null
  }

  return (
    <>
      <SubHead id={CAUTIONS_ANCHOR} text={title} />
      {warnings.length > 0 && (
        <ul class="stack reader-cautions">
          {warnings.map((warning) => (
            <li key={warning}>
              <InlineText text={warning} renderText={renderText} />
            </li>
          ))}
        </ul>
      )}
      {methodology !== undefined && (
        <Fold title={methodology.title}>
          <NoteList lines={methodology.lines} renderText={renderText} />
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
