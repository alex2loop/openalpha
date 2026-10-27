import { useMemo } from 'preact/hooks'

import { tr } from '@/web/text/tr'
import { InlineMarkdown } from '@/web/ui/markdown/markdown'

// A loose line this long is an explanation, read once: it waits behind a fold.
const LONG_NOTE_CHARS = 120

interface OutlineNode {
  readonly text: string
  readonly children: OutlineNode[]
}

interface OutlineProps {
  /** Daemon text in lines, nested by leading spaces, blocks split by a blank line. */
  readonly lines: readonly string[]
}

/** Daemon text laid out by its own indentation: each top-level entry with lines under it is a fold
 *  (the first one open), the lines under it a label-and-rows hierarchy, a short line opening a
 *  block its heading, and a long loose line a closed note. */
export function Outline({ lines }: OutlineProps) {
  const blocks = useMemo(() => toBlocks(lines), [lines])
  const firstFold = blocks.flat().find((node) => node.children.length > 0)

  return (
    <div class="outline">
      {blocks.map((block, blockIndex) =>
        block.map((node, index) => (
          <TopNode
            key={`${blockIndex}:${index}`}
            node={node}
            isHeading={index === 0 && block.length > 1}
            isOpen={node === firstFold}
          />
        ))
      )}
    </div>
  )
}

interface TopNodeProps {
  readonly node: OutlineNode
  readonly isHeading: boolean
  readonly isOpen: boolean
}

function TopNode({ node, isHeading, isOpen }: TopNodeProps) {
  if (node.children.length > 0) {
    return (
      <details class="outline-fold" open={isOpen}>
        <summary>
          <InlineMarkdown text={node.text} />
        </summary>
        <div class="outline-body">
          <Nested nodes={node.children} />
        </div>
      </details>
    )
  }

  if (node.text.length > LONG_NOTE_CHARS) {
    return (
      <details class="outline-fold is-note">
        <summary>{tr('ui.office.market.note')}</summary>
        <p class="outline-note">
          <InlineMarkdown text={node.text} />
        </p>
      </details>
    )
  }

  return isHeading ? (
    <h3 class="market-sub">
      <InlineMarkdown text={node.text} />
    </h3>
  ) : (
    <p class="outline-note">
      <InlineMarkdown text={node.text} />
    </p>
  )
}

function Nested({ nodes }: { readonly nodes: readonly OutlineNode[] }) {
  return (
    <>
      {nodes.map((node, index) =>
        node.children.length === 0 ? (
          <div key={index} class="outline-line">
            <InlineMarkdown text={node.text} />
          </div>
        ) : (
          <div key={index} class="outline-group">
            <div class="outline-label">
              <InlineMarkdown text={node.text} />
            </div>
            <div class="outline-kids">
              <Nested nodes={node.children} />
            </div>
          </div>
        )
      )}
    </>
  )
}

// An indented line after a blank one still belongs to the entry above it; only an unindented
// line after a blank starts a new block.
function toBlocks(lines: readonly string[]): OutlineNode[][] {
  const blocks: OutlineNode[][] = []
  const stack: { depth: number; node: OutlineNode }[] = []
  let block: OutlineNode[] = []
  let isBreak = false

  for (const line of lines) {
    const text = line.trim()

    if (text === '') {
      isBreak = true
      continue
    }

    const depth = line.length - line.trimStart().length

    if (isBreak && depth === 0 && block.length > 0) {
      blocks.push(block)
      block = []
      stack.length = 0
    }

    isBreak = false

    while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) >= depth) {
      stack.pop()
    }

    const node: OutlineNode = { text, children: [] }
    const parent = stack.at(-1)

    if (parent === undefined) {
      block.push(node)
    } else {
      parent.node.children.push(node)
    }

    stack.push({ depth, node })
  }

  return block.length > 0 ? [...blocks, block] : blocks
}
