import type { MessageKey } from '@/i18n'
import { agents, selectedAgentId } from '@/web/state/agents'
import { ALERT_CREATE_COMMAND, SUGGEST_COMMAND, WATCHLIST_ADD_COMMAND } from '@/web/state/command'
import { commands, estimateText } from '@/web/state/estimates'
import { panelView } from '@/web/state/panel'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { useArgCompletions } from '@/web/ui/command/arg-completions'
import { type Match, useTickerMatches } from '@/web/ui/command/ticker-matches'

const COMMAND_PREFIX = '/'
const WORD_BREAK = /\s+/
// Lists every schedule; it costs no AI.
const SCHEDULE_LIST_COMMAND = '/schedule list'
// What a focused, empty box offers first.
interface Starter {
  readonly text: string
  readonly label: MessageKey
  /** The agent picking it makes the receiver; the pick itself costs nothing. */
  readonly agentId?: string
}

const STARTERS: readonly Starter[] = [
  { text: '/brief', label: 'ui.office.common.readBrief' },
  { text: '/portfolio', label: 'ui.office.common.seeBook' },
  { text: '/suggest ', label: 'ui.office.command.ctxSuggestOne' },
  { text: '/research ', label: 'ui.office.command.ctxResearch' },
]

type Section = 'suggestions' | 'args' | 'ticker' | 'commands' | 'send'

/** One row. `fill` is the text it puts in the box; the send row has none. */
export interface SuggestOption {
  readonly key: string
  readonly section: Section
  readonly label: string
  readonly detail?: string
  readonly fill?: string
  /** Picking the row also hands what is typed next to this agent. */
  readonly agentId?: string
}

const SECTION_TITLES = Object.freeze({
  suggestions: 'ui.office.command.suggestions',
  args: 'ui.office.command.arguments',
  ticker: 'ui.office.common.ticker',
  commands: 'ui.office.command.commands',
} as const satisfies Record<Exclude<Section, 'send'>, MessageKey>)

/** The rows for what is typed, and the syntax lines of the command typed. */
interface Suggestions {
  readonly options: readonly SuggestOption[]
  readonly usage: readonly string[]
}

/** The rows for what is typed: the command's arguments, tickers, then commands, then send; starters
 *  on an empty box, or every command once Tab asked for them. A ticker the arguments already offer
 *  is listed once. */
export function useSuggestions(text: string, isAllCommands: boolean): Suggestions {
  const matches = useTickerMatches(resolveTickerQuery(text))
  const args = useArgCompletions(text)

  if (text.trim() === '') {
    return { options: isAllCommands ? listCommands('') : listStarters(), usage: [] }
  }

  const rows = listArgs(text, args.candidates)
  const taken = new Set(rows.map((row) => row.label.toLowerCase()))
  const tickers = listTickers(text, matches).filter((row) => !taken.has(row.label.toLowerCase()))

  return {
    options: [...rows, ...tickers, ...listCommands(text), buildSendRow(text)],
    usage: args.usage,
  }
}

interface SuggestPopoverProps {
  readonly id: string
  readonly options: readonly SuggestOption[]
  readonly usage: readonly string[]
  readonly activeIndex: number | undefined
  readonly onPick: (option: SuggestOption) => void
}

/** The list above the box. A press must not take focus from the input. */
export function SuggestPopover({ id, options, usage, activeIndex, onPick }: SuggestPopoverProps) {
  return (
    <div
      id={id}
      class="suggest-popover glass is-strong"
      role="listbox"
      aria-label={tr('ui.office.command.suggestions')}
    >
      {usage.length > 0 && (
        <div class="suggest-usage meta">
          {usage.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      <div class="suggest-scroll">
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
      {title && heading !== undefined && <p class="suggest-head">{tr(heading)}</p>}
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

function listStarters(): readonly SuggestOption[] {
  return [...buildContext(), ...STARTERS].map((starter) => ({
    key: `starter:${starter.label}:${starter.text}`,
    section: 'suggestions',
    label: tr(starter.label),
    ...(starter.text.trim() === ''
      ? {}
      : {
          detail: joinDetail(
            starter.text.trim(),
            estimateText(starter.text.trim().split(WORD_BREAK, 1)[0] ?? '')
          ),
        }),
    fill: starter.text,
    ...(starter.agentId === undefined ? {} : { agentId: starter.agentId }),
  }))
}

// What the open view suggests first: a ticker card's next steps, or an agent's desk.
function buildContext(): readonly Starter[] {
  const view = panelView.value

  if ('ticker' in view) {
    return buildTickerContext(view.ticker)
  }

  return 'agent' in view ? buildAgentContext(view.agent) : []
}

// Only an agent of the operator's own takes typed work.
function buildAgentContext(agentId: string): readonly Starter[] {
  const isOwn = agents.value.some((agent) => agent.id === agentId)

  return [
    ...(isOwn ? [{ text: '', label: 'ui.office.command.ctxAgent' as const, agentId }] : []),
    { text: SCHEDULE_LIST_COMMAND, label: 'ui.office.command.ctxSchedules' },
  ]
}

// With a ticker card open, what the operator most likely does next with that name.
function buildTickerContext(ticker: string): readonly Starter[] {
  return [
    { text: `${SUGGEST_COMMAND} ${ticker}`, label: 'ui.office.command.ctxSuggest' },
    { text: `${ALERT_CREATE_COMMAND} ${ticker} `, label: 'ui.office.command.ctxAlert' },
    { text: `${WATCHLIST_ADD_COMMAND} ${ticker}`, label: 'ui.office.command.ctxWatch' },
  ]
}

// What follows the last word typed, kept after the words before it.
function listArgs(text: string, candidates: readonly string[]): readonly SuggestOption[] {
  const head = text.trimStart().split(WORD_BREAK).slice(0, -1).join(' ')

  return candidates.map((candidate) => ({
    key: `arg:${head}:${candidate}`,
    section: 'args',
    label: candidate,
    fill: `${head} ${candidate} `,
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
