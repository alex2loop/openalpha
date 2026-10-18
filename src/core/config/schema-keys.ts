import { z } from 'zod'

type SchemaNode = z.core.$ZodType

/** The setting names a schema accepts in the table at `path`: what an unknown key can be offered
 *  instead of. A union offers every arm's names, as it cannot say which arm the operator meant. */
export function knownKeysAt(
  schema: SchemaNode,
  path: readonly (string | number)[]
): readonly string[] {
  const tables = path.reduce<readonly SchemaNode[]>(
    (nodes, segment) => nodes.flatMap((node) => childrenOf(node, segment)),
    [schema]
  )

  return tables.flatMap(variantsOf).flatMap((node) => {
    return node instanceof z.ZodObject ? Object.keys(node.shape) : []
  })
}

function childrenOf(node: SchemaNode, segment: string | number): readonly SchemaNode[] {
  return variantsOf(node).flatMap((variant) => {
    if (variant instanceof z.ZodObject) {
      const child = variant.shape[segment]

      return child === undefined ? [] : [child]
    }

    if (variant instanceof z.ZodArray) {
      return [variant.element]
    }

    return variant instanceof z.ZodRecord ? [variant.valueType] : []
  })
}

function variantsOf(node: SchemaNode): readonly SchemaNode[] {
  if (node instanceof z.ZodUnion) {
    return node.options.flatMap(variantsOf)
  }

  if (
    node instanceof z.ZodOptional ||
    node instanceof z.ZodNullable ||
    node instanceof z.ZodDefault
  ) {
    return variantsOf(node.unwrap())
  }

  return [node]
}
