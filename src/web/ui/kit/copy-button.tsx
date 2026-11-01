import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

const COPIED_MS = 2_000

/** Puts `text` on the clipboard and says so for a moment. */
export function CopyButton({ text, label }: { readonly text: string; readonly label: string }) {
  const isCopied = useSignal(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function copy(): void {
    navigator.clipboard.writeText(text).then(
      () => {
        isCopied.value = true
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          isCopied.value = false
        }, COPIED_MS)
      },
      // A browser that refuses the clipboard leaves the button as it was: nothing was copied.
      () => undefined
    )
  }

  return (
    <Button size="small" onClick={copy}>
      {isCopied.value ? tr('ui.office.ticker.copied') : label}
    </Button>
  )
}
