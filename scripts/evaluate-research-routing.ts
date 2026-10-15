import { runRoutingEvaluator } from './research-routing/cli'

if (import.meta.main) {
  runRoutingEvaluator().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
