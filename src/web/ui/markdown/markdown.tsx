import { useMemo } from 'preact/hooks'

import type { Block, Inline, ReportDoc } from '@/web/ui/markdown/parse'
import { reducedMotion } from '@/web/state/prefs'
import { parseReport, sourceAnchor } from '@/web/ui/markdown/parse'
import { Sources } from '@/web/ui/reader/sources'
import { LinkedText } from '@/web/ui/ticker/linked-text'

import './markdown.css'

// Anchors exist only where one report owns the page; a chat holds many and keeps none.
interface RenderContext {
  readonly isLinked: boolean
  readonly sourceNumbers: ReadonlySet<number> | undefined
}

interface ReportViewProps {
  readonly doc: ReportDoc
  /** Known tickers become links. */
  readonly isLinked?: boolean
  /** Headings and sources carry ids, and `[n]` jumps to source n. */
  readonly isAnchored?: boolean
}

/** Markdown from the daemon or a model, as JSX nodes only: nothing here ever reaches `innerHTML`. */
export function Markdown({ text, isLinked = true }: { text: string; isLinked?: boolean }) {
  const doc = useMemo(() => parseReport(text), [text])

  return <ReportView doc={doc} isLinked={isLinked} />
}

/** A parsed report: its blocks, then the sources its footnotes name. */
export function ReportView({ doc, isLinked = true, isAnchored = false }: ReportViewProps) {
  if (doc.blocks.length === 0 && doc.sources.length === 0) {
    return null
  }

  const context: RenderContext = {
    isLinked,
    sourceNumbers: isAnchored ? new Set(doc.sources.map((source) => source.n)) : undefined,
  }

  return (
    <div class="md">
      {doc.blocks.map((block, index) => (
        <BlockView key={index} block={block} context={context} />
      ))}
      <Sources sources={doc.sources} isAnchored={isAnchored} />
    </div>
  )
}

/** Scrolls to the element with `id` and moves focus there. */
export function jumpTo(id: string): void {
  const target = document.getElementById(id)

  if (target === null) {
    return
  }

  target.scrollIntoView({ behavior: reducedMotion.value ? 'auto' : 'smooth', block: 'start' })
  target.focus({ preventScroll: true })
}

const HEADING_TAGS = ['h2', 'h3', 'h4', 'h5', 'h6', 'h6'] as const

function BlockView({ block, context }: { block: Block; context: RenderContext }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = HEADING_TAGS[block.level - 1] ?? 'h6'

      return (
        <Tag
          class="md-heading"
          id={context.sourceNumbers === undefined ? undefined : block.id}
          tabIndex={-1}
        >
          <InlineList nodes={block.inline} context={context} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p class="md-p">
          <InlineList nodes={block.inline} context={context} />
        </p>
      )
    case 'list':
      return <ListView list={block} context={context} />
    case 'table':
      return <TableView table={block} context={context} />
    case 'quote':
      return (
        <blockquote class="md-quote">
          <InlineList nodes={block.inline} context={context} />
        </blockquote>
      )
    case 'rule':
      return <hr class="md-rule" />
  }
}

type ListBlock = Extract<Block, { kind: 'list' }>
type TableBlock = Extract<Block, { kind: 'table' }>

function ListView({ list, context }: { list: ListBlock; context: RenderContext }) {
  const Tag = list.ordered ? 'ol' : 'ul'

  return (
    <Tag class="md-list" start={list.ordered ? list.items[0]?.n : undefined}>
      {list.items.map((item, index) => (
        <li key={index}>
          <InlineList nodes={item.inline} context={context} />
          {item.sub !== undefined && <ListView list={item.sub} context={context} />}
        </li>
      ))}
    </Tag>
  )
}

function TableView({ table, context }: { table: TableBlock; context: RenderContext }) {
  return (
    <div class="md-table">
      <table>
        <thead>
          <tr>
            {table.head.map((cell, index) => (
              <th key={index}>
                <InlineList nodes={cell} context={context} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td key={index}>
                  <InlineList nodes={cell} context={context} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function InlineList({ nodes, context }: { nodes: readonly Inline[]; context: RenderContext }) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineView key={index} node={node} context={context} />
      ))}
    </>
  )
}

function InlineView({ node, context }: { node: Inline; context: RenderContext }) {
  switch (node.kind) {
    case 'text':
      return context.isLinked ? <LinkedText text={node.text} /> : node.text
    case 'bold':
      return (
        <strong>
          <InlineList nodes={node.children} context={context} />
        </strong>
      )
    case 'italic':
      return (
        <em>
          <InlineList nodes={node.children} context={context} />
        </em>
      )
    case 'code':
      return <code class="md-code">{node.text}</code>
    case 'note':
      return <NoteView n={node.n} context={context} />
    case 'link':
      return (
        <a href={node.href} title={node.href} target="_blank" rel="noopener noreferrer">
          {node.text}
        </a>
      )
  }
}

// A footnote jumps to its source when the page holds that source; else it is just text.
function NoteView({ n, context }: { n: number; context: RenderContext }) {
  if (context.sourceNumbers?.has(n) !== true) {
    return `[${n}]`
  }

  const id = sourceAnchor(n)

  return (
    <sup>
      <a
        href={`#${id}`}
        onClick={(event) => {
          event.preventDefault()
          jumpTo(id)
        }}
      >
        [{n}]
      </a>
    </sup>
  )
}
