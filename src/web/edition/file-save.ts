import { effect, signal } from '@preact/signals'

import { holdRestartFor, requestDbExport } from '@/web/edition/worker-link'
import { onCommandFinished } from '@/web/state/events'
import { ledgerRevision } from '@/web/state/trade'
import { tr } from '@/web/text/tr'

/** A few seconds, so a run of writes (a batch of `/record` lines) is one copy. */
const AUTOSAVE_DEBOUNCE_MS = 4_000
/** Commands that write what a visitor cannot fetch again. */
const SAVING_COMMANDS = Object.freeze([
  'record',
  'update',
  'delete',
  'profile',
  'watchlist',
  'suggest',
])
const HANDLE_DB = 'oa.file'
const HANDLE_STORE = 'handles'
const HANDLE_KEY = 'save'
const PERMISSION = { mode: 'readwrite' } as const
const PICKER_TYPE = 'application/vnd.sqlite3'
const PICKER_EXTENSIONS = ['.db', '.sqlite']

interface FileAutosaveOptions {
  readonly handle: FileSystemFileHandle
  /** The database as one file; called once per copy. */
  readonly read: () => Promise<ArrayBuffer>
  readonly debounceMs: number
  readonly onSaved: (at: number) => void
  readonly onFailed: () => void
}

interface FileAutosave {
  /** Marks the data changed: a copy is written after the debounce. */
  schedule(): void
  /** Writes a copy now, changed or not; resolves when it has settled. */
  flush(): Promise<void>
  /** Clears the timer and the listener, writes the change still waiting and waits for a write in
   *  flight. Idempotent. */
  stop(): Promise<void>
}

/** Where the copy stands. `paused` is a file the page cannot write without the visitor: the
 *  browser forgot its permission, or the last write failed. */
export type SaveStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'active'; readonly name: string; readonly savedAt?: number }
  | { readonly kind: 'paused'; readonly name: string; readonly failed: boolean }

export const saveStatus = signal<SaveStatus>({ kind: 'none' })

interface Active {
  readonly handle: FileSystemFileHandle
  readonly autosave: FileAutosave
  readonly stopTriggers: () => void
}

let active: Active | undefined
let pausedHandle: FileSystemFileHandle | undefined

/** Whether this browser lets a page write a file the visitor picked (Chromium). */
export function canPickSaveFile(): boolean {
  return typeof window.showSaveFilePicker === 'function'
}

/** Writes a full copy to a swap file that replaces the target when it closes, so a tab closed
 *  mid-write leaves the old copy or the new one, never half of each. The copy is written after a
 *  debounce, and at once when the tab goes to the background. */
function createFileAutosave(options: FileAutosaveOptions): FileAutosave {
  const lifetime = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let tail: Promise<void> = Promise.resolve()
  let isDirty = false
  let isStopped = false
  const save = (): Promise<void> => {
    clearTimeout(timer)
    isDirty = false
    tail = tail.then(async () => {
      isDirty = !(await writeCopy(options))
    })

    return tail
  }

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden' && isDirty && !isStopped) {
        save().catch(options.onFailed)
      }
    },
    { signal: lifetime.signal }
  )

  return {
    schedule() {
      if (isStopped) {
        return
      }

      isDirty = true
      clearTimeout(timer)
      timer = setTimeout(() => save().catch(options.onFailed), options.debounceMs)
    },
    flush: () => (isStopped ? tail : save()),
    async stop() {
      isStopped = true
      clearTimeout(timer)
      lifetime.abort()
      await (isDirty ? save() : tail)
    },
  }
}

async function writeCopy(options: FileAutosaveOptions): Promise<boolean> {
  let writable: FileSystemWritableFileStream | undefined

  try {
    const bytes = await options.read()

    writable = await options.handle.createWritable()
    await writable.write(bytes)
    await writable.close()
    options.onSaved(Date.now())

    return true
  } catch {
    // The status line says the copy did not land; the swap file is dropped, so the old copy stays.
    await writable?.abort().catch(() => undefined)
    options.onFailed()

    return false
  }
}

/** Starts the copy the visitor chose on an earlier visit: the stored file is written again only
 *  when the browser still lets the page, and never asks on load. Returns the way to stop. */
export function startFileSave(): () => void {
  const lifetime = new AbortController()
  const releaseRestart = holdRestartFor(stopActive)

  restore(lifetime.signal).catch(() => {
    saveStatus.value = { kind: 'none' }
  })

  return () => {
    releaseRestart()
    lifetime.abort()
    stopActive().catch(() => undefined)
  }
}

async function restore(abort: AbortSignal): Promise<void> {
  const handle = canPickSaveFile() ? await loadHandle() : undefined
  const permission = await handle?.queryPermission(PERMISSION)

  if (abort.aborted) {
    return
  }

  if (handle === undefined) {
    saveStatus.value = { kind: 'none' }
  } else if (permission === 'granted') {
    activate(handle)
  } else {
    pause(handle, false)
  }
}

/** The visitor picks the file: from now on a copy goes there. The first copy is written at once. */
export async function chooseSaveFile(): Promise<void> {
  const picker = window.showSaveFilePicker
  let handle: FileSystemFileHandle

  if (picker === undefined) {
    return
  }

  try {
    handle = await picker.call(window, {
      suggestedName: tr('ui.office.edition.file.suggestedName'),
      types: [
        {
          description: tr('ui.office.edition.file.pickerType'),
          accept: { [PICKER_TYPE]: PICKER_EXTENSIONS },
        },
      ],
    })
  } catch (error: unknown) {
    // A dismissed picker is an answer, not a failure.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return
    }

    throw error
  }

  await storeHandle(handle)
  await stopActive()
  await activate(handle).autosave.flush()
}

/** "Tiếp tục lưu vào file": asked on a click, never on load. */
export async function resumeSaveFile(): Promise<void> {
  const handle = pausedHandle ?? active?.handle

  if (handle === undefined || (await handle.requestPermission(PERMISSION)) !== 'granted') {
    return
  }

  await stopActive()
  await activate(handle).autosave.flush()
}

/** Stops copying and forgets the file; the file itself stays where it is. */
export async function forgetSaveFile(): Promise<void> {
  await stopActive()
  pausedHandle = undefined
  saveStatus.value = { kind: 'none' }
  await withHandleStore('readwrite', (store) => store.delete(HANDLE_KEY))
}

function activate(handle: FileSystemFileHandle): Active {
  const autosave = createFileAutosave({
    handle,
    read: requestDbExport,
    debounceMs: AUTOSAVE_DEBOUNCE_MS,
    onSaved: (savedAt) => {
      saveStatus.value = { kind: 'active', name: handle.name, savedAt }
    },
    onFailed: () => pause(handle, true),
  })

  pausedHandle = undefined
  saveStatus.value = { kind: 'active', name: handle.name }
  active = { handle, autosave, stopTriggers: watchWrites(autosave) }

  return active
}

function pause(handle: FileSystemFileHandle, failed: boolean): void {
  pausedHandle = handle
  saveStatus.value = { kind: 'paused', name: handle.name, failed }
}

async function stopActive(): Promise<void> {
  const current = active

  active = undefined
  current?.stopTriggers()
  await current?.autosave.stop()
}

// A ledger write from a form bumps the revision; the commands write through the chat.
function watchWrites(autosave: FileAutosave): () => void {
  let seen = ledgerRevision.peek()
  const stopRevision = effect(() => {
    const current = ledgerRevision.value

    if (current === seen) {
      return
    }

    seen = current
    autosave.schedule()
  })
  const stops = SAVING_COMMANDS.map((name) => onCommandFinished(name, () => autosave.schedule()))

  return () => {
    stopRevision()

    for (const stop of stops) {
      stop()
    }
  }
}

async function loadHandle(): Promise<FileSystemFileHandle | undefined> {
  const stored = await withHandleStore('readonly', (store) => store.get(HANDLE_KEY))

  return stored instanceof FileSystemFileHandle ? stored : undefined
}

async function storeHandle(handle: FileSystemFileHandle): Promise<void> {
  await withHandleStore('readwrite', (store) => store.put(handle, HANDLE_KEY))
}

function openHandleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1)

    request.onupgradeneeded = () => {
      request.result.createObjectStore(HANDLE_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withHandleStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openHandleDatabase()

  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(HANDLE_STORE, mode).objectStore(HANDLE_STORE))

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
