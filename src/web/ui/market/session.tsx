import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { ClockIcon } from '@/web/ui/kit/icons'
import { Markdown } from '@/web/ui/markdown/markdown'
import { BlockFrame } from '@/web/ui/today/block-frame'

const LINE_BREAK = '\n'

/** "Phiên gần nhất đã chốt": what `/market` prints for the region. It reads the sources and can take
 *  seconds, so it is read when the view opens and on Làm mới, never on a timer. */
export function Session({ region }: { readonly region: string }) {
  const reading = useBlock(ROUTES.marketSession, { query: { region } })

  return (
    <BlockFrame
      title={tr('ui.office.market.session')}
      colour="peach"
      icon={<ClockIcon />}
      reading={reading}
      loadingText={tr('ui.office.market.sessionLoading')}
      action={
        <Button size="small" onClick={reading.retry}>
          {tr('ui.office.market.refresh')}
        </Button>
      }
    >
      {(session) => <Markdown text={session.text.join(LINE_BREAK)} />}
    </BlockFrame>
  )
}
