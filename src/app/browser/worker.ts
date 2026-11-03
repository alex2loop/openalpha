import '@/ai/api'
import '@/commands/api'
import '@/engine/api'
import '@/i18n'
import '@/persistence/api'
import '@/tools/api'
import '@/trading/api'

addEventListener('message', (event) => {
  postMessage(event.data)
})
