import { createContext } from 'preact'
import { useContext, useMemo } from 'preact/hooks'

import { withoutLeadingIcon } from '@/web/text/glyphs'

/** The sentences a block already shows as caution strips, so its body does not say them again. */
export const CautionsContext = createContext<readonly string[]>([])

/** The daemon's lines minus those a caution strip of the same block already says. */
export function useUnstripped(lines: readonly string[]): readonly string[] {
  const cautions = useContext(CautionsContext)

  return useMemo(
    () => lines.filter((line) => !cautions.includes(withoutLeadingIcon(line))),
    [lines, cautions]
  )
}
