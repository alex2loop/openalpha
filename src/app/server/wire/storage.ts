// GET /v1/storage: whether the browser agreed to keep the visitor's data. Wire-only: this file
// imports nothing.

/** `persisted` is the browser's answer to the one request the page made for persistent storage;
 *  null while none was made (the browser has no such request, or the page has not asked yet). */
export interface StorageStatusResponse {
  readonly persisted: boolean | null
}
