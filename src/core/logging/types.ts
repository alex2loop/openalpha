import type { DestinationStream } from 'pino'

export interface OwnedLogDestination {
  readonly stream: DestinationStream
  isAvailable(): boolean
  stopWrites(): void
  flush(): Promise<void>
  close(): Promise<void>
  forceClose(): void
}
