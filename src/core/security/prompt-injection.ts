export type ThreatSeverity = 'notice' | 'block'

export interface InjectionPattern {
  readonly name: string
  readonly pattern: RegExp
  /**
   * Tier this pattern carries when scanning content (tool output, memory). `block` is reserved for
   * high-precision signals that would steer the model on replay; heuristic prose patterns stay
   * `notice` so ordinary text is annotated, never refused. `scanSkill` overrides both — installing a
   * skill installs instructions, so every signal disqualifies there.
   */
  readonly severity: ThreatSeverity
}

export const INJECTION_PATTERNS: ReadonlyArray<InjectionPattern> = Object.freeze([
  {
    name: 'override_instructions',
    // Up to 3 filler words ("the", "your", "any of the") between the verb and its target — the
    // fixed `all?` filler let "ignore the previous instructions" through.
    pattern:
      /(ignore|disregard|forget|bypass)\s+(?:\w+\s+){0,3}(previous|prior|above|system|earlier|initial)\s+(instructions|rules|constraints|prompts?|guidelines)/i,
    severity: 'block',
  },
  {
    // No bare `dan`: `dan_mode` already covers the jailbreak, and the loose alternative refused
    // every note about a person named Dan.
    name: 'role_hijack',
    pattern: /(you\s+are\s+now|act\s+as|developer\s+mode|jailbreak|unrestricted\s+mode)/i,
    severity: 'notice',
  },
  {
    name: 'exfiltrate_system_prompt',
    pattern:
      /(reveal|show|print|dump|leak|display)\s+((the|your)\s+)?(system|developer|hidden)\s+(prompt|instructions|rules|message)/i,
    severity: 'block',
  },
  {
    // The verb is required: a bare noun match rejects routine notes that merely mention a ticker
    // token or a password policy.
    name: 'exfiltrate_credentials',
    pattern:
      /(reveal|show|print|dump|leak|display|send|email|upload|post)\s+(?:\w+\s+){0,3}(api\s*key|secret|token|password|private\s+key|credentials?|session\s+cookie|jwt|bearer)/i,
    severity: 'block',
  },
  { name: 'im_start_token', pattern: /<\|im_start\|>/, severity: 'block' },
  { name: 'im_end_token', pattern: /<\|im_end\|>/, severity: 'block' },
  { name: 'endoftext_token', pattern: /<\|endoftext\|>/, severity: 'block' },
  { name: 'llama_inst_open', pattern: /\[inst\]/i, severity: 'block' },
  { name: 'llama_inst_close', pattern: /\[\/inst\]/i, severity: 'block' },
  // Llama BOS/EOS, but also the HTML strikethrough tag — annotate rather than refuse.
  { name: 'sentence_open_token', pattern: /<s>/, severity: 'notice' },
  { name: 'sentence_close_token', pattern: /<\/s>/, severity: 'notice' },
  {
    name: 'ignore_previous_instructions',
    pattern: /ignore\s+(?:\w+\s+){0,3}previous\s+instructions/i,
    severity: 'block',
  },
  { name: 'you_are_now', pattern: /you\s+are\s+now\b/i, severity: 'notice' },
  { name: 'do_not_tell_user', pattern: /do\s+not\s+tell\s+the\s+user/i, severity: 'block' },
  { name: 'system_prompt_override', pattern: /system\s+prompt\s+override/i, severity: 'block' },
  {
    name: 'disregard_instructions',
    pattern: /disregard\s+(?:\w+\s+){0,3}(?:instructions|rules|guidelines)/i,
    severity: 'block',
  },
  {
    name: 'act_without_restrictions',
    pattern: /act\s+as\s+if\s+you\s+(?:have\s+no|don'?t\s+have)\s+restrictions/i,
    severity: 'notice',
  },
  { name: 'dan_mode', pattern: /\bdan\s+mode\b|do\s+anything\s+now/i, severity: 'notice' },
  { name: 'developer_mode_enabled', pattern: /developer\s+mode\s+enabled/i, severity: 'notice' },
  {
    name: 'respond_without_restrictions',
    pattern: /respond\s+without\s+(?:restrictions|safety|filters)/i,
    severity: 'notice',
  },
  {
    name: 'unwatched',
    pattern: /(?:when|if)\s+no\s*one\s+is\s+(?:watching|looking)/i,
    severity: 'notice',
  },
  {
    name: 'output_system_prompt',
    pattern: /output\s+(?:the\s+)?(?:system|initial)\s+prompt/i,
    severity: 'block',
  },
  {
    name: 'reserved_config_files',
    pattern: /AGENTS\.md|CLAUDE\.md|\.cursorrules/,
    severity: 'notice',
  },
])
