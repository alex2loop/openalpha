import type { ServerFrame } from '@/app/server/wire/socket'

/** Where one chat client's frames go: the daemon's socket, or the port a browser page listens on.
 *  The runners write here and know nothing of the transport behind it. */
export interface FrameSink {
  /** A frame the client cannot take (it is gone, or its buffer is full) is dropped, not thrown. */
  send(frame: ServerFrame): void
  /** True once the client is gone: a run still going stops writing to it and winds down. */
  readonly closed: boolean
}
