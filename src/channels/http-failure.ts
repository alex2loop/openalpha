export const RATE_LIMITED_STATUS = 429
const REQUEST_TIMEOUT_STATUS = 408
const CLIENT_ERROR_MIN_STATUS = 400
const SERVER_ERROR_MIN_STATUS = 500

/** What a channel keeps of a platform's error text: it reaches logs and error messages. */
export const MAX_ERROR_DESCRIPTION_LEN = 512

/** A client error other than a timeout or a rate limit (a bad request, a blocked bot, a revoked
 *  token) says the same thing on every attempt; a server error or a dropped line may not. */
export function isPermanentStatus(status: number): boolean {
  return (
    status >= CLIENT_ERROR_MIN_STATUS &&
    status < SERVER_ERROR_MIN_STATUS &&
    status !== REQUEST_TIMEOUT_STATUS &&
    status !== RATE_LIMITED_STATUS
  )
}
