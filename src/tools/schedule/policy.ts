// Single-owner scheduled-job cap. The schedule tool advertises it, the scoped store enforces it,
// and nothing else hardcodes 100.
export const SCHEDULER_MAX_JOBS = 100
