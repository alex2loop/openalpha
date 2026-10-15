import { isPlainRecord } from '@/core/utils/collections'

// Moonshot answers 400 "not a valid moonshot flavored json schema" unless every property names a
// type, `anyOf` carries the types on its branches and holds no null branch, a scalar enum lists no
// null or empty value, and every object lists `required`.
const MOONSHOT_MODEL_RE = /(?:^|\/)(?:kimi-|k3(?:[.-]|$))/i
const SCHEMA_MAP_KEYS: ReadonlySet<string> = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
])
const SCHEMA_LIST_KEYS: ReadonlySet<string> = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems'])
const SCHEMA_NODE_KEYS: ReadonlySet<string> = new Set([
  'items',
  'contains',
  'not',
  'additionalProperties',
  'propertyNames',
  'if',
  'then',
  'else',
])
const SCALAR_TYPES: ReadonlySet<unknown> = new Set(['string', 'integer', 'number', 'boolean'])
const CONDITIONAL_KEYS = ['if', 'then', 'else'] as const

type SchemaNode = Record<string, unknown>

export function isMoonshotModel(model: string): boolean {
  return MOONSHOT_MODEL_RE.test(model)
}

export function toMoonshotSchema(parameters: Readonly<SchemaNode>): SchemaNode {
  const repaired = repairNode(parameters)
  const root = isPlainRecord(repaired) ? repaired : {}

  return withRequiredList({ ...root, type: 'object', properties: root.properties ?? {} })
}

function repairNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(repairNode)
  }

  if (!isPlainRecord(node)) {
    return node
  }

  const collapsed = collapseNullBranches(repairChildren(node))

  if (Array.isArray(collapsed.anyOf)) {
    return collapsed
  }

  const { nullable, ...rest } = collapsed
  const typed = '$ref' in rest ? rest : withType(rest)
  const cleaned = withoutBlankEnum(typed)

  return cleaned.type === 'object' ? withRequiredList(cleaned) : cleaned
}

function repairChildren(node: SchemaNode): SchemaNode {
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => {
      if (SCHEMA_MAP_KEYS.has(key) && isPlainRecord(value)) {
        return [key, Object.fromEntries(Object.entries(value).map(([k, v]) => [k, repairNode(v)]))]
      }

      const isSchemaList = SCHEMA_LIST_KEYS.has(key) && Array.isArray(value)
      const isSchemaNode = SCHEMA_NODE_KEYS.has(key) && isPlainRecord(value)

      return [key, isSchemaList || isSchemaNode ? repairNode(value) : value]
    })
  )
}

// A union with one real branch beside null becomes that branch; a wider union only loses its nulls.
function collapseNullBranches(node: SchemaNode): SchemaNode {
  if (!Array.isArray(node.anyOf)) {
    return node
  }

  const { type, anyOf, ...rest } = node
  const branches = anyOf.filter((branch) => !(isPlainRecord(branch) && branch.type === 'null'))

  if (branches.length === 0 || branches.length === anyOf.length) {
    return { ...rest, anyOf }
  }

  const [only] = branches

  if (branches.length > 1 || !isPlainRecord(only)) {
    return { ...rest, anyOf: branches }
  }

  return { ...rest, ...only }
}

function withType(node: SchemaNode): SchemaNode {
  if (Array.isArray(node.type)) {
    const concrete = node.type.find((t) => typeof t === 'string' && t !== '' && t !== 'null')
    return { ...node, type: concrete ?? 'string' }
  }

  if (typeof node.type === 'string' && node.type !== '') {
    return node
  }

  if (CONDITIONAL_KEYS.some((key) => key in node)) {
    return node
  }

  return { ...node, type: inferredType(node) }
}

function inferredType(node: SchemaNode): string {
  if ('properties' in node || 'required' in node || 'additionalProperties' in node) {
    return 'object'
  }

  if ('items' in node || 'prefixItems' in node) {
    return 'array'
  }

  const sample = Array.isArray(node.enum) ? node.enum[0] : undefined

  if (typeof sample === 'boolean') {
    return 'boolean'
  }

  if (typeof sample === 'number') {
    return Number.isInteger(sample) ? 'integer' : 'number'
  }

  return 'string'
}

function withoutBlankEnum(node: SchemaNode): SchemaNode {
  if (!(Array.isArray(node.enum) && SCALAR_TYPES.has(node.type))) {
    return node
  }

  const { enum: values, ...rest } = node
  const kept = values.filter((value) => value !== null && value !== '')

  return kept.length > 0 ? { ...rest, enum: kept } : rest
}

function withRequiredList(node: SchemaNode): SchemaNode {
  const properties = isPlainRecord(node.properties) ? node.properties : undefined

  if (!Array.isArray(node.required)) {
    return { ...node, required: [] }
  }

  return properties === undefined
    ? node
    : { ...node, required: node.required.filter((name) => name in properties) }
}
