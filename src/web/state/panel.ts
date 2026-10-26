import { signal } from '@preact/signals'

const BACK_MAX = 20

/** The info panel's element, open or folded: where the skip link lands. */
export const PANEL_ELEMENT_ID = 'info-panel'

export type PanelTab = 'today' | 'book' | 'ideas'
/** A part of an agent's tab: its steps now, its result, profile and work. */
export type AgentSection = 'progress' | 'result' | 'profile' | 'work'

export type PanelView =
  | { readonly tab: PanelTab }
  | { readonly agent: string; readonly section?: AgentSection }
  | { readonly ticker: string; readonly market: string }

/** What the info panel shows now. */
export const panelView = signal<PanelView>({ tab: 'today' })
/** Where "Quay lại" goes, newest last. */
export const backStack = signal<readonly PanelView[]>([])
/** The panel is folded into its icon strip. */
export const collapsed = signal(false)
/** Focus mode: the office is hidden and only the information shows. */
export const isFocus = signal(false)

/** Shows `view`, remembering the one it leaves; a tab click passes `fresh` and starts over. */
export function openView(view: PanelView, opts: { readonly fresh?: true } = {}): void {
  const current = panelView.value

  if (opts.fresh === true) {
    backStack.value = []
  } else if (!isSameView(current, view)) {
    backStack.value = [...backStack.value, current].slice(-BACK_MAX)
  }

  panelView.value = view
  collapsed.value = false
}

export function goBack(): void {
  const previous = backStack.value.at(-1)

  if (previous === undefined) {
    return
  }

  backStack.value = backStack.value.slice(0, -1)
  panelView.value = previous
}

export function toggleFocus(): void {
  isFocus.value = !isFocus.value
}

function isSameView(a: PanelView, b: PanelView): boolean {
  if ('tab' in a && 'tab' in b) {
    return a.tab === b.tab
  }

  if ('agent' in a && 'agent' in b) {
    return a.agent === b.agent
  }

  return 'ticker' in a && 'ticker' in b && a.ticker === b.ticker && a.market === b.market
}
