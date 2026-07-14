import {
  XFeedError,
  type XFeedErrorCode,
  type XFeedSource,
  type XPost,
  type XPostMedia,
  type XPostReference,
} from '../types.js'

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_FEED_ITEMS = 200
const X_ID_PATTERN = /^[0-9]{1,19}$/
const XML_DANGEROUS_DECLARATION_PATTERN = /<!\s*(?:DOCTYPE|ENTITY)\b/i

export type XRssProvider = 'nitter' | 'rsshub'

export interface XRssResponseInfo {
  provider: XRssProvider
  status: number
  contentType: string | null
  contentLength: number | null
}

export interface XRssSourceOptions {
  /**
   * Known X-to-RSS route shape.
   */
  provider: XRssProvider
  /**
   * Base URL of a trusted Nitter-compatible or RSSHub instance.
   */
  baseUrl: string
  /**
   * Standards-compatible fetch implementation for custom runtimes and tests.
   */
  fetch?: typeof globalThis.fetch
  /**
   * Optional server-side headers, for example self-hosted Basic auth.
   */
  headers?: Readonly<Record<string, string>>
  /**
   * Numeric X user ID when known. RSS feeds often omit it.
   */
  authorId?: string
  /**
   * Display-name fallback when the feed does not expose one.
   */
  authorName?: string
  /**
   * Profile-image fallback when the feed does not expose one.
   */
  profileImageUrl?: string
  /**
   * Maximum accepted XML payload size.
   */
  maxResponseBytes?: number
  /**
   * Optional operational metadata hook.
   */
  onResponse?: (info: XRssResponseInfo) => void
}

/**
 * Creates a lightweight X source backed by a trusted RSS endpoint.
 *
 * The adapter understands Nitter-compatible `/username/rss` feeds and the
 * RSSHub `/twitter/user/username` route. It does not scrape x.com directly.
 */
export function createXRssSource(options: XRssSourceOptions): XFeedSource {
  const provider = resolveProvider(options?.provider)
  const baseUrl = resolveBaseUrl(options?.baseUrl)
  const fetchImplementation = options?.fetch ?? globalThis.fetch
  const headers = resolveHeaders(options?.headers)
  const authorId = resolveOptionalXId(options?.authorId, 'authorId')
  const authorName = resolveOptionalText(options?.authorName, 'authorName', 256)
  const profileImageUrl = resolveOptionalHttpsUrl(
    options?.profileImageUrl,
    'profileImageUrl',
  )
  const maxResponseBytes = resolveMaxResponseBytes(options?.maxResponseBytes)
  const sourceId = `x-rss-${provider}`

  if (typeof fetchImplementation !== 'function') {
    throw invalidConfiguration('A fetch implementation is required.', sourceId)
  }

  return {
    id: sourceId,
    metadata: {
      kind: 'rss-bridge',
      stability: 'experimental',
      label:
        provider === 'nitter'
          ? 'Nitter-compatible RSS'
          : 'RSSHub X route',
      official: false,
      warning:
        'Unofficial X data bridge. It may stop working without notice when X, the bridge, or its authenticated sessions change.',
    },
    async fetchPosts({ config, signal, sinceId }) {
      const url = buildFeedUrl(provider, baseUrl, config.username)
      const xml = await requestXml({
        provider,
        sourceId,
        url,
        signal,
        fetchImplementation,
        headers,
        maxResponseBytes,
        onResponse: options.onResponse,
      })

      const posts = parseXFeedXml(xml, {
        provider,
        sourceId,
        baseUrl,
        username: config.username,
        authorId,
        authorName,
        profileImageUrl,
      })

      if (!sinceId) {
        return posts
      }

      const minimumId = BigInt(sinceId)
      return posts.filter((post) => BigInt(post.id) > minimumId)
    },
  }
}

interface RequestXmlOptions {
  provider: XRssProvider
  sourceId: string
  url: URL
  signal: AbortSignal
  fetchImplementation: typeof globalThis.fetch
  headers: Readonly<Record<string, string>>
  maxResponseBytes: number
  onResponse: XRssSourceOptions['onResponse']
}

async function requestXml(options: RequestXmlOptions): Promise<string> {
  const response = await options.fetchImplementation(options.url, {
    method: 'GET',
    headers: {
      accept:
        'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      ...options.headers,
    },
    signal: options.signal,
  })

  const contentLength = readHeaderInteger(
    response.headers.get('content-length'),
  )

  options.onResponse?.({
    provider: options.provider,
    status: response.status,
    contentType: response.headers.get('content-type'),
    contentLength,
  })

  if (contentLength !== null && contentLength > options.maxResponseBytes) {
    throw new XFeedError(
      'INVALID_RESPONSE',
      `X RSS source "${options.sourceId}" exceeded the response-size limit.`,
      { sourceId: options.sourceId, status: response.status },
    )
  }

  if (!response.ok) {
    throw createHttpError(options.sourceId, response.status)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())

  if (bytes.byteLength > options.maxResponseBytes) {
    throw new XFeedError(
      'INVALID_RESPONSE',
      `X RSS source "${options.sourceId}" exceeded the response-size limit.`,
      { sourceId: options.sourceId, status: response.status },
    )
  }

  const xml = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim()

  if (xml.length === 0 || XML_DANGEROUS_DECLARATION_PATTERN.test(xml)) {
    throw invalidResponse(options.sourceId, response.status)
  }

  return xml
}

interface ParseFeedOptions {
  provider: XRssProvider
  sourceId: string
  baseUrl: URL
  username: string
  authorId: string | null
  authorName: string | null
  profileImageUrl: string | null
}

function parseXFeedXml(xml: string, options: ParseFeedOptions): XPost[] {
  const rssItems = extractElements(xml, 'item')
  const atomEntries = rssItems.length === 0 ? extractElements(xml, 'entry') : []
  const entries = rssItems.length > 0 ? rssItems : atomEntries
  const feedKind = rssItems.length > 0 ? 'rss' : 'atom'
  const metadataXml = removeElements(
    removeElements(xml, 'item'),
    'entry',
  )
  const feedTitle = cleanFeedTitle(
    readElementText(metadataXml, ['title']),
    options.username,
  )
  const feedImageUrl = readFeedImageUrl(metadataXml, options.baseUrl)
  const posts: XPost[] = []

  for (const entry of entries.slice(0, MAX_FEED_ITEMS)) {
    const post = parseFeedEntry(entry, feedKind, {
      ...options,
      feedTitle,
      feedImageUrl,
    })

    if (post) {
      posts.push(post)
    }
  }

  // A syntactically valid empty feed is allowed. A response that looks like
  // neither RSS nor Atom is not.
  if (
    entries.length === 0 &&
    !/<(?:[A-Za-z_][\w.-]*:)?(?:rss|feed|channel)\b/i.test(xml)
  ) {
    throw invalidResponse(options.sourceId)
  }

  return posts
}

interface ParseEntryOptions extends ParseFeedOptions {
  feedTitle: string | null
  feedImageUrl: string | null
}

function parseFeedEntry(
  entry: string,
  feedKind: 'rss' | 'atom',
  options: ParseEntryOptions,
): XPost | null {
  const rawLink = readEntryLink(entry, feedKind)
  const rawGuid = readElementText(entry, ['guid', 'id'])
  const postIdentity = readPostIdentity(rawLink ?? rawGuid, options.username)

  if (!postIdentity) {
    return null
  }

  const rawTitle = readElementText(entry, ['title'])
  const rawBody = readElementText(entry, [
    'description',
    'encoded',
    'content',
    'summary',
  ])
  const text = normalizePostText(rawTitle) ?? normalizePostText(rawBody)
  const rawDate = readElementText(entry, [
    'pubDate',
    'published',
    'updated',
    'date',
  ])
  const createdAt = normalizeDate(rawDate)

  if (!text || !createdAt) {
    return null
  }

  const creator = normalizeCreator(
    readElementText(entry, ['creator']) ?? readNestedAuthorName(entry),
  )
  const authorUsername = creator?.username ?? postIdentity.username
  const creatorDisplayName =
    creator && creator.name.toLowerCase() !== creator.username.toLowerCase()
      ? creator.name
      : null
  const authorName =
    creatorDisplayName ??
    options.authorName ??
    options.feedTitle ??
    authorUsername
  const isRepost = authorUsername.toLowerCase() !== options.username.toLowerCase()
  const references: XPostReference[] = isRepost
    ? [{ type: 'reposted', postId: postIdentity.id }]
    : []

  return {
    id: postIdentity.id,
    source: 'x',
    kind: 'post',
    url: `https://x.com/${authorUsername}/status/${postIdentity.id}`,
    text,
    createdAt,
    language: null,
    conversationId: null,
    author: {
      id:
        authorUsername.toLowerCase() === options.username.toLowerCase()
          ? options.authorId
          : null,
      username: authorUsername,
      name: authorName,
      profileImageUrl:
        authorUsername.toLowerCase() === options.username.toLowerCase()
          ? options.profileImageUrl ?? options.feedImageUrl
          : null,
      verified: null,
      protected: null,
    },
    metrics: {
      replies: 0,
      reposts: 0,
      likes: 0,
      quotes: 0,
      bookmarks: null,
      impressions: null,
    },
    media: readEntryMedia(entry, options.baseUrl, postIdentity.id),
    references,
  }
}

function buildFeedUrl(
  provider: XRssProvider,
  baseUrl: URL,
  username: string,
): URL {
  const path =
    provider === 'nitter'
      ? `${encodeURIComponent(username)}/rss`
      : `twitter/user/${encodeURIComponent(username)}`

  return new URL(path, ensureTrailingSlash(baseUrl))
}

function readPostIdentity(
  value: string | null,
  fallbackUsername: string,
): { id: string; username: string } | null {
  if (!value) {
    return null
  }

  const decoded = decodeXmlEntities(stripCdata(value)).trim()
  const match = decoded.match(
    /\/(?:@)?([A-Za-z0-9_]{1,50})\/status(?:es)?\/([0-9]{1,19})(?:\b|\/|#|\?)/i,
  )

  if (match?.[2]) {
    return {
      id: match[2],
      username: match[1] ?? fallbackUsername,
    }
  }

  const idMatch = decoded.match(/(?:^|\D)([0-9]{1,19})(?:\D|$)/)
  if (!idMatch?.[1]) {
    return null
  }

  return { id: idMatch[1], username: fallbackUsername }
}

function readEntryLink(entry: string, feedKind: 'rss' | 'atom'): string | null {
  if (feedKind === 'atom') {
    const links = readOpeningTags(entry, 'link')
    const alternate = links.find((attributes) => {
      const relation = attributes.rel?.toLowerCase()
      return relation === undefined || relation === 'alternate'
    })
    const href = alternate?.href

    if (href) {
      return href
    }
  }

  return readElementText(entry, ['link'])
}

function readEntryMedia(
  entry: string,
  baseUrl: URL,
  postId: string,
): XPostMedia[] {
  const media: XPostMedia[] = []
  const candidates = [
    ...readOpeningTags(entry, 'enclosure').map((attributes) => ({
      attributes,
      kind: 'enclosure' as const,
    })),
    ...readOpeningTags(entry, 'content').map((attributes) => ({
      attributes,
      kind: 'content' as const,
    })),
  ]
  const thumbnails = readOpeningTags(entry, 'thumbnail')
    .map((attributes) => resolveHttpUrl(attributes.url, baseUrl))
    .filter((value): value is string => value !== null)

  for (const [index, candidate] of candidates.entries()) {
    const rawUrl = candidate.attributes.url ?? candidate.attributes.href
    const url = resolveHttpUrl(rawUrl, baseUrl)
    const contentType = candidate.attributes.type?.toLowerCase() ?? ''
    const medium = candidate.attributes.medium?.toLowerCase() ?? ''
    const inferredType = inferMediaType(contentType, medium, url)

    if (!url || !inferredType) {
      continue
    }

    media.push({
      key: `rss:${postId}:${index}`,
      type: inferredType,
      url: inferredType === 'photo' ? url : null,
      previewImageUrl:
        inferredType === 'photo' ? url : thumbnails[0] ?? null,
      altText: null,
      width: readPositiveInteger(candidate.attributes.width),
      height: readPositiveInteger(candidate.attributes.height),
      durationMs: readDurationMs(candidate.attributes.duration),
    })
  }

  return media
}

function inferMediaType(
  contentType: string,
  medium: string,
  url: string | null,
): XPostMedia['type'] | null {
  const pathname = url ? new URL(url).pathname.toLowerCase() : ''

  if (
    contentType === 'image/gif' ||
    pathname.endsWith('.gif')
  ) {
    return 'animated_gif'
  }

  if (
    contentType.startsWith('image/') ||
    medium === 'image' ||
    /\.(?:avif|jpe?g|png|webp)$/.test(pathname)
  ) {
    return 'photo'
  }

  if (
    contentType.startsWith('video/') ||
    medium === 'video' ||
    /\.(?:m3u8|mov|mp4|webm)$/.test(pathname)
  ) {
    return 'video'
  }

  return null
}

function readFeedImageUrl(xml: string, baseUrl: URL): string | null {
  const imageElement = extractElements(xml, 'image')[0]
  const imageUrl = imageElement
    ? readElementText(imageElement, ['url'])
    : null
  const logo = imageUrl ?? readElementText(xml, ['logo', 'icon'])
  return resolveHttpUrl(logo, baseUrl)
}

function readNestedAuthorName(entry: string): string | null {
  const authorElement = extractElements(entry, 'author')[0]
  return authorElement ? readElementText(authorElement, ['name']) : null
}

function normalizeCreator(
  value: string | null,
): { username: string; name: string } | null {
  const text = normalizePostText(value)
  if (!text) {
    return null
  }

  const handleMatch = text.match(/@([A-Za-z0-9_]{1,50})/)
  const plainHandleMatch = text.match(/^([A-Za-z0-9_]{1,50})$/)
  const username = handleMatch?.[1] ?? plainHandleMatch?.[1]

  if (!username) {
    return null
  }

  const name = text
    .replace(new RegExp(`@?${escapeRegExp(username)}`, 'i'), '')
    .replace(/[()[\]|·-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { username, name: name || username }
}

function normalizePostText(value: string | null): string | null {
  if (!value) {
    return null
  }

  const decodedInput = decodeXmlEntities(stripCdata(value))
  const decoded = decodedInput
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|blockquote|pre|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return decoded.length > 0 ? decoded.slice(0, 10_000) : null
}

function normalizeDate(value: string | null): string | null {
  if (!value) {
    return null
  }

  const timestamp = Date.parse(decodeXmlEntities(stripCdata(value)).trim())
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

function extractElements(xml: string, localName: string): string[] {
  const escaped = escapeRegExp(localName)
  const pattern = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${escaped}\\s*>`,
    'gi',
  )
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? '')
}

function removeElements(xml: string, localName: string): string {
  const escaped = escapeRegExp(localName)
  return xml.replace(
    new RegExp(
      `<(?:[A-Za-z_][\\w.-]*:)?${escaped}\\b[^>]*>[\\s\\S]*?<\\/(?:[A-Za-z_][\\w.-]*:)?${escaped}\\s*>`,
      'gi',
    ),
    '',
  )
}

function readElementText(xml: string, localNames: readonly string[]): string | null {
  for (const localName of localNames) {
    const value = extractElements(xml, localName)[0]
    if (value !== undefined) {
      return value
    }
  }

  return null
}

function readOpeningTags(
  xml: string,
  localName: string,
): Array<Record<string, string>> {
  const escaped = escapeRegExp(localName)
  const pattern = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${escaped}\\b([^>]*)\\/?>`,
    'gi',
  )

  return [...xml.matchAll(pattern)].map((match) =>
    readAttributes(match[1] ?? ''),
  )
}

function readAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

  for (const match of value.matchAll(pattern)) {
    const rawName = match[1]
    const rawValue = match[2] ?? match[3]

    if (!rawName || rawValue === undefined) {
      continue
    }

    const name = rawName.includes(':') ? rawName.split(':').at(-1) : rawName
    if (name) {
      attributes[name.toLowerCase()] = decodeXmlEntities(rawValue)
    }
  }

  return attributes
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d{1,7})|#x([0-9A-Fa-f]{1,6})|amp|lt|gt|quot|apos);/g,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal || hexadecimal) {
        const codePoint = Number.parseInt(decimal ?? hexadecimal ?? '', hexadecimal ? 16 : 10)
        if (
          !Number.isInteger(codePoint) ||
          codePoint < 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return '\uFFFD'
        }

        return String.fromCodePoint(codePoint)
      }

      switch (entity) {
        case '&amp;':
          return '&'
        case '&lt;':
          return '<'
        case '&gt;':
          return '>'
        case '&quot;':
          return '"'
        case '&apos;':
          return "'"
        default:
          return entity
      }
    },
  )
}

function cleanFeedTitle(value: string | null, username: string): string | null {
  const title = normalizePostText(value)
  if (!title) {
    return null
  }

  const cleaned = title
    .replace(new RegExp(`^@?${escapeRegExp(username)}\\s*[/|:-]\\s*`, 'i'), '')
    .replace(/\s*[/|:-]\s*(?:twitter|x)\s*$/i, '')
    .trim()

  return cleaned || username
}

function resolveProvider(value: XRssProvider | undefined): XRssProvider {
  if (value !== 'nitter' && value !== 'rsshub') {
    throw invalidConfiguration('provider must be "nitter" or "rsshub".')
  }

  return value
}

function resolveBaseUrl(value: string | undefined): URL {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidConfiguration('baseUrl is required.')
  }

  try {
    const url = new URL(value)
    const isLocalHttp =
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]')

    if (url.protocol !== 'https:' && !isLocalHttp) {
      throw new Error('unsupported protocol')
    }

    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return ensureTrailingSlash(url)
  } catch (error) {
    throw invalidConfiguration('baseUrl must be HTTPS or local HTTP.', undefined, error)
  }
}

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url)
  copy.pathname = copy.pathname.endsWith('/')
    ? copy.pathname
    : `${copy.pathname}/`
  return copy
}

function resolveHeaders(
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (value === undefined) {
    return {}
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidConfiguration('headers must be a string record.')
  }

  const headers: Record<string, string> = {}

  for (const [name, headerValue] of Object.entries(value)) {
    const normalizedName = name.trim().toLowerCase()

    if (
      normalizedName.length === 0 ||
      typeof headerValue !== 'string' ||
      /[\r\n]/.test(normalizedName) ||
      /[\r\n]/.test(headerValue)
    ) {
      throw invalidConfiguration('headers contain an invalid value.')
    }

    if (normalizedName === 'accept' || normalizedName === 'content-length') {
      throw invalidConfiguration(`The ${normalizedName} header is managed internally.`)
    }

    headers[normalizedName] = headerValue
  }

  return headers
}

function resolveOptionalXId(
  value: string | undefined,
  field: string,
): string | null {
  if (value === undefined) {
    return null
  }

  if (!X_ID_PATTERN.test(value)) {
    throw invalidConfiguration(`${field} must be a valid X user ID.`)
  }

  return value
}

function resolveOptionalText(
  value: string | undefined,
  field: string,
  maximum: number,
): string | null {
  if (value === undefined) {
    return null
  }

  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximum) {
    throw invalidConfiguration(`${field} is invalid.`)
  }

  return normalized
}

function resolveOptionalHttpsUrl(
  value: string | undefined,
  field: string,
): string | null {
  if (value === undefined) {
    return null
  }

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') {
      throw new Error('not HTTPS')
    }
    return url.toString()
  } catch (error) {
    throw invalidConfiguration(`${field} must be an HTTPS URL.`, undefined, error)
  }
}

function resolveMaxResponseBytes(value: number | undefined): number {
  const normalized = value ?? DEFAULT_MAX_RESPONSE_BYTES
  if (
    !Number.isInteger(normalized) ||
    normalized < 1_024 ||
    normalized > MAX_RESPONSE_BYTES
  ) {
    throw invalidConfiguration(
      `maxResponseBytes must be an integer between 1024 and ${MAX_RESPONSE_BYTES}.`,
    )
  }

  return normalized
}

function resolveHttpUrl(value: string | undefined | null, baseUrl: URL): string | null {
  if (!value) {
    return null
  }

  try {
    const url = new URL(decodeXmlEntities(value), baseUrl)
    const isLocalHttp =
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]')

    return url.protocol === 'https:' || isLocalHttp ? url.toString() : null
  } catch {
    return null
  }
}

function readHeaderInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function readPositiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function readDurationMs(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  // Media RSS duration is commonly expressed in seconds.
  return Math.round(parsed * 1_000)
}

function createHttpError(sourceId: string, status: number): XFeedError {
  let code: XFeedErrorCode = 'REQUEST_FAILED'

  if (status === 401) {
    code = 'AUTHENTICATION_FAILED'
  } else if (status === 403) {
    code = 'ACCESS_FORBIDDEN'
  } else if (status === 404) {
    code = 'NOT_FOUND'
  } else if (status === 429) {
    code = 'RATE_LIMITED'
  }

  return new XFeedError(
    code,
    `X RSS source "${sourceId}" returned HTTP ${status}.`,
    { sourceId, status },
  )
}

function invalidConfiguration(
  message: string,
  sourceId?: string,
  cause?: unknown,
): XFeedError {
  return new XFeedError('INVALID_CONFIGURATION', message, {
    cause,
    sourceId,
  })
}

function invalidResponse(sourceId: string, status?: number): XFeedError {
  return new XFeedError(
    'INVALID_RESPONSE',
    `X RSS source "${sourceId}" returned invalid XML.`,
    { sourceId, status },
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
