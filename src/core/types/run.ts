export type RunResultReason =
  | 'completed'
  | 'aborted'
  | 'budget'
  | 'error'
  | 'turn_limit'
  | 'loop'
  | 'timeout'

export type RunCompletionCode = 'approval_timeout' | 'model_tool_call_as_text'
