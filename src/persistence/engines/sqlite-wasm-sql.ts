import type { BindingSpec, Database } from '@sqlite.org/sqlite-wasm'

import type { Transaction } from '@/core/types/storage'

/** `read` is asked at every statement: replacing the database file puts a new connection under a
 *  storage that is already in use. */
export function createTransaction(read: () => Database): Transaction {
  return {
    query: async <T>(sql: string, params: readonly unknown[] = []) =>
      // why-safe: `T` is the caller's claim about its own SQL; sqlite returns untyped rows either way.
      read().exec({
        sql,
        rowMode: 'object',
        returnValue: 'resultRows',
        ...bindingOf(params),
      }) as unknown as T[],
    execute: async (sql: string, params: readonly unknown[] = []) => {
      const db = read()

      db.exec({ sql, ...bindingOf(params) })

      return { changes: db.changes() }
    },
  }
}

// An empty binding is left out so a multi-statement script (DDL) runs as one.
function bindingOf(params: readonly unknown[]): { readonly bind?: BindingSpec } {
  // why-safe: the Storage contract carries `unknown` params by design; sqlite rejects at runtime
  // any value it cannot bind.
  return params.length === 0 ? {} : { bind: params as BindingSpec }
}
