// Link preview of the two public pages (Open Graph and Twitter card), shared by both builds. The
// tags are derived from the page's own `<title>` and description, so those texts have one source;
// Open Graph needs absolute addresses, so each build passes the page's own https address.
import { resolve } from 'node:path'

import { BRAND } from '@/core/brand'

import { insertInHead } from './browser-build'

const ROOT = resolve(import.meta.dir, '..')
// One 1200x630 image for both pages: it lives in `site/` (which build-site copies whole) and
// build-web copies it beside its page.
export const PREVIEW_IMAGE_FILE = 'og.png'
export const PREVIEW_IMAGE_SOURCE = resolve(ROOT, 'site', PREVIEW_IMAGE_FILE)
const PREVIEW_IMAGE_WIDTH = 1200
const PREVIEW_IMAGE_HEIGHT = 630
const PREVIEW_IMAGE_ALT = `${BRAND.display} logo with its Vietnamese tagline: an open-source AI investment research assistant`
const LOCALE = 'en_US'
const ALTERNATE_LOCALE = 'vi_VN'
const TITLE_RE = /<title>([^<]*)<\/title>/
const DESCRIPTION_RE = /<meta\s+name="description"\s+content="([^"]*)"/

export function stampLinkPreview(html: string, pageUrl: string): string {
  const title = textOf(html, TITLE_RE, 'title')
  const description = textOf(html, DESCRIPTION_RE, 'description')

  return insertInHead(html, [
    `<link rel="canonical" href="${pageUrl}" />`,
    buildProperty('og:type', 'website'),
    buildProperty('og:site_name', BRAND.display),
    buildProperty('og:title', title),
    buildProperty('og:description', description),
    buildProperty('og:url', pageUrl),
    buildProperty('og:image', new URL(PREVIEW_IMAGE_FILE, pageUrl).href),
    buildProperty('og:image:width', String(PREVIEW_IMAGE_WIDTH)),
    buildProperty('og:image:height', String(PREVIEW_IMAGE_HEIGHT)),
    buildProperty('og:image:alt', PREVIEW_IMAGE_ALT),
    buildProperty('og:locale', LOCALE),
    buildProperty('og:locale:alternate', ALTERNATE_LOCALE),
    '<meta name="twitter:card" content="summary_large_image" />',
  ])
}

// The text is already HTML-escaped where the page states it; only a quote could end the attribute.
function textOf(html: string, pattern: RegExp, what: string): string {
  const text = pattern.exec(html)?.[1]

  if (text === undefined) {
    throw new Error(`link-preview: the page states no ${what}`)
  }

  return text.replaceAll('"', '&quot;')
}

function buildProperty(name: string, content: string): string {
  return `<meta property="${name}" content="${content}" />`
}
