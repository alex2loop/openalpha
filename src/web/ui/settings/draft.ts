import { type Signal, signal } from '@preact/signals'
import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

import { type Draft, toDraft } from '@/web/ui/settings/row'

/** What one run of Cài đặt keeps of its panels' unsaved forms. A question that replaces the dialog
 *  hands the bag back to the Cài đặt it reopens, so a cancelled one returns to what was typed. The
 *  bag lives only as long as something holds it: closing Cài đặt drops it with its drafts. */
export type DraftBag = object

/** One panel's draft: held per bag, so it goes when the bag does. */
export type DraftSlot<T extends object> = WeakMap<DraftBag, T>

export const DraftBagContext = createContext<DraftBag>({})

/** The panel's draft in this Cài đặt, made by `create` the first time. */
export function useDraft<T extends object>(slot: DraftSlot<T>, create: () => T): T {
  const bag = useContext(DraftBagContext)
  const held = slot.get(bag)

  if (held !== undefined) {
    return held
  }

  const made = create()

  slot.set(bag, made)

  return made
}

/** A row's value under edit and the one last saved. */
export interface HeldValue<T> {
  readonly draft: Signal<T>
  readonly saved: Signal<T>
}

/** A row's edit, kept in this Cài đặt's bag: it comes back after a question that replaced Cài đặt. */
export function useHeldDraft<T>(slot: DraftSlot<HeldValue<T>>, initial: T): Draft<T> {
  const { draft, saved } = useDraft(slot, () => ({
    draft: signal(initial),
    saved: signal(initial),
  }))

  return toDraft(draft, saved)
}
