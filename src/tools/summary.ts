// Every `summarizeResult` reads the tool's own JSON envelope, and a malformed one means "no
// summary", never a thrown error: the summary is decoration on a result the caller already has.
// Tolerant by design, so each tool writes only the shape check that is actually its own.
export function toSummaryJson(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}
