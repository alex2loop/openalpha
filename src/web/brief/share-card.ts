import { withDeadline } from '@/web/brief/load'

const WIDTH = 1080
const HEIGHT = 1920
const MARGIN = 96
const TEXT_WIDTH = WIDTH - MARGIN * 2
const LOGO_URL = '/icon-192.png'
const LOGO_SIZE = 168
const LOGO_TOP = 150
const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif'
const BACKGROUND = '#1c1c28'
const DAY_TOP = 420
const HEADLINE_TOP = 520
const DISCLAIMER_BOTTOM = HEIGHT - 260
const ADDRESS_TOP = HEIGHT - 190
const ELLIPSIS = '...'
const IMAGE_TYPE = 'image/png'
const FILE_NAME = 'brief.png'
const WORD_BREAK = /\s+/

interface Style {
  readonly font: string
  readonly color: string
  readonly lineHeight: number
  readonly maximumLines: number
}

const DAY_STYLE: Style = {
  font: `600 46px ${FONT_FAMILY}`,
  color: '#b6b7c9',
  lineHeight: 60,
  maximumLines: 2,
}
const HEADLINE_STYLE: Style = {
  font: `600 78px ${FONT_FAMILY}`,
  color: '#eeeef6',
  lineHeight: 100,
  maximumLines: 8,
}
const DISCLAIMER_STYLE: Style = {
  font: `400 34px ${FONT_FAMILY}`,
  color: '#b6b7c9',
  lineHeight: 48,
  maximumLines: 4,
}
const ADDRESS_STYLE: Style = {
  font: `600 44px ${FONT_FAMILY}`,
  color: '#89b4fa',
  lineHeight: 60,
  maximumLines: 1,
}

interface Placement {
  readonly style: Style
  readonly top: number
}

interface ShareCardInput {
  /** The brief's own title, which names its day. */
  readonly day: string
  readonly headline: string
  readonly disclaimer: string
  /** Where the brief lives, as a reader types it. */
  readonly address: string
  readonly signal: AbortSignal
}

class ShareCardError extends Error {}

/** Hands the card to the phone's share sheet where it takes files, else downloads it. A reader who
 *  closes the sheet shares nothing and gets no error. */
export async function shareBlob(blob: Blob): Promise<void> {
  const file = new File([blob], FILE_NAME, { type: IMAGE_TYPE })

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    await shareFile(file)

    return
  }

  downloadBlob(blob)
}

/** The card as a 1080x1920 PNG: the brand mark, the day, the headline, the disclaimer and the
 *  address. No chart and no figure. */
export async function drawShareCard(input: ShareCardInput): Promise<Blob> {
  const logo = await readLogo(input.signal)

  try {
    return await toBlob(paintCard(logo, input))
  } finally {
    logo.close()
  }
}

async function shareFile(file: File): Promise<void> {
  try {
    await navigator.share({ files: [file] })
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      throw error
    }
  }
}

function downloadBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob)

  try {
    const link = document.createElement('a')

    link.href = url
    link.download = FILE_NAME
    link.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function readLogo(signal: AbortSignal): Promise<ImageBitmap> {
  return await withDeadline(signal, async (bounded) => {
    const response = await fetch(LOGO_URL, { signal: bounded })

    if (!response.ok) {
      throw new ShareCardError(`the logo answered ${response.status}`)
    }

    return await createImageBitmap(await response.blob())
  })
}

function paintCard(logo: ImageBitmap, input: ShareCardInput): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  canvas.width = WIDTH
  canvas.height = HEIGHT

  if (context === null) {
    throw new ShareCardError('no 2d canvas')
  }

  context.fillStyle = BACKGROUND
  context.fillRect(0, 0, WIDTH, HEIGHT)
  context.drawImage(logo, MARGIN, LOGO_TOP, LOGO_SIZE, LOGO_SIZE)
  context.textBaseline = 'top'

  paintText(context, input.day, { style: DAY_STYLE, top: DAY_TOP })
  paintText(context, input.headline, { style: HEADLINE_STYLE, top: HEADLINE_TOP })
  paintText(context, input.address, { style: ADDRESS_STYLE, top: ADDRESS_TOP })

  // The disclaimer sits above the address whatever its length.
  const lines = wrapText(context, input.disclaimer, DISCLAIMER_STYLE)

  paintLines(context, lines, {
    style: DISCLAIMER_STYLE,
    top: DISCLAIMER_BOTTOM - lines.length * DISCLAIMER_STYLE.lineHeight,
  })

  return canvas
}

function paintText(context: CanvasRenderingContext2D, text: string, placement: Placement): void {
  paintLines(context, wrapText(context, text, placement.style), placement)
}

function paintLines(
  context: CanvasRenderingContext2D,
  lines: readonly string[],
  { style, top }: Placement
): void {
  context.font = style.font
  context.fillStyle = style.color

  lines.forEach((line, index) => {
    context.fillText(line, MARGIN, top + index * style.lineHeight)
  })
}

// Greedy by word. A text past its lines ends in an ellipsis that still fits the width.
function wrapText(context: CanvasRenderingContext2D, text: string, style: Style): string[] {
  context.font = style.font

  const lines: string[] = []
  let line = ''

  for (const word of text.split(WORD_BREAK).filter((part) => part !== '')) {
    const joined = line === '' ? word : `${line} ${word}`

    if (line === '' || context.measureText(joined).width <= TEXT_WIDTH) {
      line = joined
    } else {
      lines.push(line)
      line = word
    }
  }

  if (line !== '') {
    lines.push(line)
  }

  return lines.length > style.maximumLines ? withEllipsis(context, lines, style) : lines
}

function withEllipsis(
  context: CanvasRenderingContext2D,
  lines: readonly string[],
  style: Style
): string[] {
  const kept = lines.slice(0, style.maximumLines)
  let last = kept.pop() ?? ''

  while (last !== '' && context.measureText(`${last}${ELLIPSIS}`).width > TEXT_WIDTH) {
    last = last.slice(0, -1)
  }

  return [...kept, `${last}${ELLIPSIS}`]
}

async function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new ShareCardError('the canvas gave no image'))

        return
      }

      resolve(blob)
    }, IMAGE_TYPE)
  })
}
