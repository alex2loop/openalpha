import '@/ai/api'
import '@/app/server/http/dispatch'
import '@/app/server/http/routes'
import '@/app/server/ws/frame-sink'
import '@/app/server/ws/frames'
import '@/commands/api'
import '@/engine/api'
import '@/i18n'
import '@/persistence/api'
import '@/tools/api'
import '@/trading/api'

addEventListener('message', (event) => {
  postMessage(event.data)
})
