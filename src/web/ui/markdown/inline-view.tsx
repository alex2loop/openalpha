import type { ComponentChild } from 'preact'
import { useMemo } from 'preact/hooks'

import { isNoteLine, withoutLeadingIcon } from '@/web/text/glyphs'
import { type Inline, parseInline } from '@/web/ui/markdown/inline'

import './markdown.css'

/** How a run of plain text is drawn; the desktop passes one that links known tickers. */
export type TextRenderer = (text: string) => ComponentChild

type NoteRenderer = (n: number) => ComponentChild

interface InlineTextProps {
  readonly text: string
  readonly renderText?: TextRenderer | undefined
}

interface InlineNodesProps {
  readonly nodes: readonly Inline[]
  readonly renderText?: TextRenderer | undefined
  /** A footnote mark; without one it stays the text `[n]`. */
  readonly renderNote?: NoteRenderer | undefined
}

interface InlineViewProps extends Omit<InlineNodesProps, 'nodes'> {
  readonly node: Inline
}

/** One line of daemon text with its bold, italic, code and links, and no block around it. */
export function InlineText({ text, renderText }: InlineTextProps) {
  const words = isNoteLine(text) ? withoutLeadingIcon(text) : text
  const mark = text.slice(0, text.length - words.length).trimEnd()
  const nodes = useMemo(() => parseInline(words), [words])

  return (
    <>
      {mark !== '' && <span class="note-mark">{mark}</span>}
      <InlineNodes nodes={nodes} renderText={renderText} />
    </>
  )
}

/** Parsed inline nodes as JSX only: nothing here ever reaches `innerHTML`. */
export function InlineNodes({ nodes, renderText, renderNote }: InlineNodesProps) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineView key={index} node={node} renderText={renderText} renderNote={renderNote} />
      ))}
    </>
  )
}

function InlineView({ node, renderText, renderNote }: InlineViewProps) {
  switch (node.kind) {
    case 'text':
      return renderText === undefined ? node.text : renderText(node.text)
    case 'bold':
      return (
        <strong>
          <InlineNodes nodes={node.children} renderText={renderText} renderNote={renderNote} />
        </strong>
      )
    case 'italic':
      return (
        <em>
          <InlineNodes nodes={node.children} renderText={renderText} renderNote={renderNote} />
        </em>
      )
    case 'code':
      return <code class="md-code">{node.text}</code>
    case 'note':
      return renderNote === undefined ? `[${node.n}]` : renderNote(node.n)
    case 'move':
      return <span class={`move move-${node.tone}`}>{node.text}</span>
    case 'link':
      return (
        <>
          <a href={node.href} title={node.href} target="_blank" rel="noopener noreferrer">
            {node.text}
          </a>
          {node.host !== undefined && <span class="md-link-host">{node.host}</span>}
        </>
      )
  }
}
