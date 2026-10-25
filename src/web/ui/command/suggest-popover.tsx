import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { InstrumentSearchResponse } from '@/app/server/wire/market'
import type { MessageKey } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { agents, selectedAgentId } from '@/web/state/agents'
import { commands, estimateText } from '@/web/state/estimates'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

const INSTRUMENT_DEBOUNCE_MS = 200
const MAX_TICKER_MATCHES = 5
const COMMAND_PREFIX = '/'
const WORD_BREAK = /\s+/
// What a focused, empty box offers first.
const STARTERS: readonly { readonly text: string; readonly label: MessageKey }[] = [
  { text: '/brief', label: 'ui.office.common.readBrief' },
  { text: '/portfolio', label: 'ui.office.common.seeBook' },
  { text: '/suggest ', label: 'ui.office.command.ctxSuggestOne' },
  { text: '/research ', label: 'ui.office.command.ctxResearch' },
]

type Section = 'suggestions' | 'ticker' | 'commands' | 'send'

/** One row. `fill` is the text it puts in the box; the send row has none. */
export interface SuggestOption {
  readonly key: string
  readonly section: Section
  readonly label: string
  readonly detail?: string
  readonly fill?: string
}

type Match = InstrumentSearchResponse['matches'][number]

const SECTION_TITLES = Object.freeze({
  suggestions: 'ui.office.command.suggestions',
  ticker: 'ui.office.common.ticker',
  commands: 'ui.office.command.commands',
} as const satisfies Record<Exclude<Section, 'send'>, MessageKey>)

/** The rows for what is typed: tickers, then commands, then send; starters on an empty box, or
 *  every command once Tab asked for them. */
export function useSuggestions(text: string, isAllCommands: boolean): readonly SuggestOption[] {
  const matches = useTickerMatches(resolveTickerQuery(text))

  if (text.trim() === '') {
    return isAllCommands ? listCommands('') : listStarters()
  }

  return [...listTickers(text, matches), ...listCommands(text), buildSendRow(text)]
}

interface SuggestPopoverProps {
  readonly id: string
  readonly options: readonly SuggestOption[]
  readonly activeIndex: number | undefined
  readonly onPick: (option: SuggestOption) => void
}

/** The list above the box. A press must not take focus from the input. */
export function SuggestPopover({ id, options, activeIndex, onPick }: SuggestPopoverProps) {
  return (
    <div
      id={id}
      class="suggest-popover"
      role="listbox"
      aria-label={tr('ui.office.command.suggestions')}
    >
      {options.length > 0 && options[0]?.section === 'suggestions' && (
        <p class="meta suggest-hint">{tr('ui.office.command.hint')}</p>
      )}
      {options.map((option, index) => (
        <SuggestRow
          key={option.key}
          option={option}
          title={index === 0 || options[index - 1]?.section !== option.section}
          isActive={index === activeIndex}
          onPick={onPick}
        />
      ))}
      <p class="meta suggest-keys">{tr('ui.office.command.keys')}</p>
    </div>
  )
}

interface SuggestRowProps {
  readonly option: SuggestOption
  readonly title: boolean
  readonly isActive: boolean
  readonly onPick: (option: SuggestOption) => void
}

function SuggestRow({ option, title, isActive, onPick }: SuggestRowProps) {
  const heading = option.section === 'send' ? undefined : SECTION_TITLES[option.section]

  return (
    <>
      {title && heading !== undefined && <p class="popover-section">{tr(heading)}</p>}
      <div
        role="option"
        tabIndex={-1}
        aria-selected={isActive}
        class={isActive ? 'suggest-row is-active' : 'suggest-row'}
        onPointerDown={(event) => {
          event.preventDefault()
          onPick(option)
        }}
      >
        <b>{option.label}</b>
        {option.detail !== undefined && <span class="meta">{option.detail}</span>}
      </div>
    </>
  )
}

// A single word is a ticker; after a command, its last word is.
function resolveTickerQuery(text: string): string | undefined {
  const words = text.trimStart().split(WORD_BREAK)
  const last = words.at(-1) ?? ''

  if (last === '' || last.startsWith(COMMAND_PREFIX)) {
    return undefined
  }

  const isCommand = words[0]?.startsWith(COMMAND_PREFIX) === true

  return words.length === 1 || (isCommand && words.length === 2) ? last : undefined
}

// Waits out the typing, then asks; the previous request is aborted and so is one in flight on unmount.
function useTickerMatches(query: string | undefined): readonly Match[] {
  const matches = useSignal<readonly Match[]>([])

  useEffect(() => {
    matches.value = []

    if (query === undefined) {
      return undefined
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      getJson(ROUTES.instruments, {
        query: { q: query, limit: MAX_TICKER_MATCHES },
        signal: controller.signal,
      }).then(
        (answer) => {
          matches.value = answer.matches.slice(0, MAX_TICKER_MATCHES)
        },
        // A failed search lists no tickers, and an abort is this effect's own; the box still sends.
        () => undefined
      )
    }, INSTRUMENT_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  return matches.value
}

function listStarters(): readonly SuggestOption[] {
  return STARTERS.map((starter) => ({
    key: `starter:${starter.text}`,
    section: 'suggestions',
    label: tr(starter.label),
    detail: joinDetail(starter.text.trim(), estimateText(starter.text.trim())),
    fill: starter.text,
  }))
}

function listTickers(text: string, matches: readonly Match[]): readonly SuggestOption[] {
  const head = text.trimStart().split(WORD_BREAK).slice(0, -1).join(' ')

  return matches.map((match) => ({
    key: `ticker:${match.instrument.market}:${match.instrument.ticker}`,
    section: 'ticker',
    label: match.instrument.ticker,
    ...(match.name === undefined ? {} : { detail: match.name }),
    fill: head === '' ? match.instrument.ticker : `${head} ${match.instrument.ticker}`,
  }))
}

// While the first word is still being typed, the commands it starts.
function listCommands(text: string): readonly SuggestOption[] {
  const typed = text.trimStart()

  if (typed !== '' && (!typed.startsWith(COMMAND_PREFIX) || WORD_BREAK.test(typed))) {
    return []
  }

  return commands.value
    .filter((command) => command.name.startsWith(typed))
    .map((command) => ({
      key: `command:${command.name}`,
      section: 'commands',
      label: command.name,
      detail: joinDetail(command.summary, estimateText(command.name)),
      fill: `${command.name} `,
    }))
}

function buildSendRow(text: string): SuggestOption {
  const typed = text.trim()
  const name = typed.split(WORD_BREAK, 1)[0] ?? ''

  if (typed.startsWith(COMMAND_PREFIX)) {
    return {
      key: 'send',
      section: 'send',
      label: tr('ui.office.command.run'),
      detail: joinDetail(typed, estimateText(name)),
    }
  }

  return { key: 'send', section: 'send', label: resolveSendLabel(), detail: typed }
}

/** "Gửi", or "Gửi cho {agent}" while an own agent receives what is typed. */
export function resolveSendLabel(): string {
  const selected = agents.value.find((agent) => agent.id === selectedAgentId.value)

  return selected === undefined
    ? tr('ui.office.command.send')
    : tr('ui.office.command.sendTo', { agent: selected.name })
}

function joinDetail(text: string, estimate: string | undefined): string {
  return estimate === undefined ? text : joinInline([text, estimate])
}
