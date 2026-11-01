import { createContext } from 'preact'
import { useContext, useMemo } from 'preact/hooks'

import { cautionSaying } from '@/web/text/caution-text'

/** The sentences a block already shows as caution strips, so its body does not say them again. */
export const CautionsContext = createContext<readonly string[]>([])

/** The daemon's lines minus those a caution strip of the same block already says. */
export function useUnstripped(lines: readonly string[]): readonly string[] {
  const cautions = useContext(CautionsContext)

  return useMemo(() => {
    const said = new Set(cautions.map(cautionSaying))

    return lines.filter((line) => !said.has(cautionSaying(line)))
  }, [lines, cautions])
}
