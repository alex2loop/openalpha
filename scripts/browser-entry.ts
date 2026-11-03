// The barrels the browser worker root will need. The gate bundles this until the root imports them
// itself and tsconfig.browser.json can typecheck the engine they pull in.
import '@/ai/api'
import '@/commands/api'
import '@/engine/api'
import '@/i18n'
import '@/persistence/api'
import '@/tools/api'
import '@/trading/api'
