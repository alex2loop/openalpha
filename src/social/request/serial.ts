export interface KeyedSerial {
  run<T>(key: string, task: () => Promise<T>): Promise<T>
}

/** One task at a time per key. The map holds only keys with work in flight: each entry is removed
 *  when its tail settles and is still the newest, so it never grows with history. */
export function createKeyedSerial(): KeyedSerial {
  const tails = new Map<string, Promise<unknown>>()

  return {
    run(key, task) {
      const previous = tails.get(key) ?? Promise.resolve()
      const next = previous.then(task, task)
      const tail = next.catch(() => undefined)

      tails.set(key, tail)
      tail.finally(() => {
        if (tails.get(key) === tail) {
          tails.delete(key)
        }
      })

      return next
    },
  }
}
