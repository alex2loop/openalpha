import { signal } from '@preact/signals'

const BACK_MAX = 20

type PanelTab = 'today' | 'book' | 'ideas'

type PanelView =
  | { readonly tab: PanelTab }
  | { readonly agent: string }
  | { readonly ticker: string; readonly market: string }

/** What the info panel shows now. */
const panelView = signal<PanelView>({ tab: 'today' })
/** Where "Quay lại" goes, newest last. */
const backStack = signal<readonly PanelView[]>([])
/** The panel is folded into its icon strip. */
const collapsed = signal(false)

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

function isSameView(a: PanelView, b: PanelView): boolean {
  if ('tab' in a && 'tab' in b) {
    return a.tab === b.tab
  }

  if ('agent' in a && 'agent' in b) {
    return a.agent === b.agent
  }

  return 'ticker' in a && 'ticker' in b && a.ticker === b.ticker && a.market === b.market
}
