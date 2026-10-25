// The one import scanner the boundary gates share (`check-dag`, `check-scene-layers`).

// Static import/export-from statements, incl. multiline bodies. The middle part can never
// contain a quote (specifiers are the only strings in an import clause), so [^'"]*? cannot
// jump across statements. Type-only imports follow the same module boundaries as value imports.
const STATIC_SPEC_RE = /\b(?:import|export)\s+(?:type\s+)?[^'"]*?from\s*'([^']+)'/gs
// Side-effect (`import './x'`) and dynamic (`import('x')`) imports — always value imports.
const BARE_SPEC_RE = /\bimport\s*(\(\s*)?'([^']+)'\s*\)?/g

export interface FoundImport {
  specifier: string
  index: number
  isTypeOnly: boolean
  isDynamic: boolean
  statementKind: 'import' | 'export'
  clause?: string
}

export const lineAt = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length

export const scanImports = (source: string): FoundImport[] => {
  const found: FoundImport[] = []
  for (const m of source.matchAll(STATIC_SPEC_RE)) {
    const specifier = m[1]
    if (specifier !== undefined) {
      const statement = m[0]
      const typeOnly = /^\s*(?:import|export)\s+type\s+/.test(statement)
      const statementKind = /^\s*import\b/.test(statement) ? 'import' : 'export'
      const clause = statement.match(/\b(?:import|export)\s+(?:type\s+)?([^'\"]*?)\s+from\s*'/s)?.[1]

      found.push({ specifier, index: m.index, isTypeOnly: typeOnly, isDynamic: false, statementKind, clause })
    }
  }
  for (const m of source.matchAll(BARE_SPEC_RE)) {
    const specifier = m[2]
    if (specifier !== undefined) {
      found.push({ specifier, index: m.index, isTypeOnly: false, isDynamic: m[1] !== undefined, statementKind: 'import' })
    }
  }
  return found
}
