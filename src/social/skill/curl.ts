import type { HttpMethod } from '@/social/types'
import { HTTP_METHODS } from '@/social/constants'

const CURL_METHOD_RE = /(?:-X|--request)\s+([A-Z]+)/
const CURL_URL_RE = /["']?(https:\/\/[^\s"']+)["']?/
const CURL_DATA_RE = /(?:-d|--data(?:-raw)?)\s+'([^']*)'/
const CURL_AUTH_RE = /-H\s+["']([A-Za-z-]+):\s*([A-Za-z]+)/g
const API_KEY_HEADER_RE = /(api-key|token)$/i

export interface CurlCommand {
  readonly method: HttpMethod
  readonly url: URL
  readonly body?: string
  readonly authSchemes: readonly string[]
  /** Where the command ends, so the answer example after it can be found. */
  readonly endIndex: number
}

interface LogicalLine {
  readonly text: string
  readonly endIndex: number
}

/** Lines with their trailing `\` continuations joined, and where each one ends in the text. */
function logicalLines(text: string): readonly LogicalLine[] {
  const raw = text.split('\n')
  const lines: LogicalLine[] = []
  let offset = 0

  for (let i = 0; i < raw.length; i++) {
    let joined = raw[i] ?? ''
    offset += joined.length + 1

    while (joined.trimEnd().endsWith('\\') && i + 1 < raw.length) {
      i += 1
      const next = raw[i] ?? ''

      joined = `${joined.trimEnd().slice(0, -1)} ${next}`
      offset += next.length + 1
    }

    lines.push({ text: joined, endIndex: offset })
  }

  return lines
}

export function curlCommands(text: string): readonly CurlCommand[] {
  return logicalLines(text).flatMap((line) => {
    const command = line.text.trim().startsWith('curl ') ? toCurl(line) : undefined

    return command === undefined ? [] : [command]
  })
}

function toCurl(line: LogicalLine): CurlCommand | undefined {
  const rawUrl = CURL_URL_RE.exec(line.text)?.[1]
  const body = CURL_DATA_RE.exec(line.text)?.[1]
  const method = CURL_METHOD_RE.exec(line.text)?.[1] ?? (body === undefined ? 'GET' : 'POST')
  const url = rawUrl === undefined ? undefined : parseUrl(rawUrl)

  if (url === undefined || !isHttpMethod(method)) {
    return undefined
  }

  return {
    method,
    url,
    ...(body === undefined ? {} : { body }),
    authSchemes: authSchemesOf(line.text),
    endIndex: line.endIndex,
  }
}

export function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw)
  } catch {
    return undefined
  }
}

export function isHttpMethod(value: string): value is HttpMethod {
  return HTTP_METHODS.some((method) => method === value)
}

function authSchemesOf(line: string): readonly string[] {
  const schemes: string[] = []

  for (const match of line.matchAll(CURL_AUTH_RE)) {
    const header = match[1] ?? ''

    if (header.toLowerCase() === 'authorization') {
      schemes.push(match[2] ?? '')
    } else if (API_KEY_HEADER_RE.test(header)) {
      schemes.push('header')
    }
  }

  return schemes
}
