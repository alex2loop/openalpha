import type { Dialect } from '@/core/types/storage'
import { buildInsert, buildUpsert, paramList } from '@/persistence/sql/syntax'

function sqliteParam(index: number): string {
  return `?${index}`
}

export const sqliteDialect: Dialect = {
  name: 'sqlite',
  autoIncrementPk: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  param: sqliteParam,
  paramList: (count, startAt) => paramList(sqliteParam, count, startAt),
  upsert: (table, target) => buildUpsert(sqliteParam, table, target),
  insert: (table, target) => buildInsert(sqliteParam, table, target),
}
