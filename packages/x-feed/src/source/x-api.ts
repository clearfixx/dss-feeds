import {
  XFeedError,
  type XFeedErrorCode,
  type XFeedSource,
  type XPost,
  type XPostAuthor,
  type XPostMedia,
  type XPostMediaType,
  type XPostReference,
} from '../types.js'

const X_API_BASE_URL = 'https://api.x.com/2'
const X_API_SOURCE_ID = 'x-api'
const X_ID_PATTERN = /^[0-9]{1,19}$/
const DEFAULT_USER_CACHE_TTL_MS = 60 * 60 * 1_000
const MAX_USER_CACHE_TTL_MS = 24 * 60 * 60 * 1_000

const USER_FIELDS = [
  'id',
  'name',
  'profile_image_url',
  'protected',
  'username',
  'verified',
].join(',')

const POST_FIELDS = [
  'attachments',
  'author_id',
  'conversation_id',
  'created_at',
  'lang',
  'public_metrics',
  'referenced_tweets',
].join(',')

const MEDIA_FIELDS = [
  'alt_text',
  'duration_ms',
  'height',
  'media_key',
  'preview_image_url',
  'type',
  'url',
  'width',
].join(',')

export type XApiEndpoint = 'user_lookup' | 'user_posts'

export interface XApiRateLimit {
  limit: number | null
  remaining: number | null
  resetAt: string | null
}

export interface XApiResponseInfo {
  endpoint: XApiEndpoint
  status: number
  requestId: string | null
  rateLimit: XApiRateLimit
}

export interface XApiSourceOptions {
  /**
   * Server-side X API bearer token. The token remains captured by the source.
   */
  bearerToken: string
  /**
   * Standards-compatible fetch implementation for custom runtimes and tests.
   */
  fetch?: typeof globalThis.fetch
  /**
   * In-memory user lookup cache lifetime. Set to zero to disable caching.
   */
  userCacheTtlMs?: number
  /**
   * Optional response metadata hook for rate-limit and operational monitoring.
   */
  onResponse?: (info: XApiResponseInfo) => void
}

interface CachedUser {
  expiresAt: number
  user: XPostAuthor
}

/**
 * Creates a server-side source backed by the official X API v2.
 */
export function createXApiSource(options: XApiSourceOptions): XFeedSource {
  const bearerToken = assertBearerToken(options?.bearerToken)
  const fetchImplementation = options?.fetch ?? globalThis.fetch
  const userCacheTtlMs = resolveUserCacheTtl(options?.userCacheTtlMs)

  if (typeof fetchImplementation !== 'function') {
    throw invalidConfiguration('A fetch implementation is required.')
  }

  const userCache = new Map<string, CachedUser>()

  return {
    id: X_API_SOURCE_ID,
    metadata: {
      kind: 'official-api',
      stability: 'stable',
      label: 'Official X API',
      official: true,
      warning: null,
    },
    async fetchPosts({ config, signal, sinceId }) {
      const author = await resolveUser(
        config.username,
        bearerToken,
        fetchImplementation,
        signal,
        userCache,
        userCacheTtlMs,
        options.onResponse,
      )

      if (!author.id) {
        throw invalidResponse('user_lookup')
      }

      const url = buildPostsUrl(author.id, {
        excludeReplies: config.excludeReplies,
        excludeReposts: config.excludeReposts,
        postLimit: config.postLimit,
        sinceId,
      })
      const payload = await requestJson(
        'user_posts',
        url,
        bearerToken,
        fetchImplementation,
        signal,
        options.onResponse,
      )

      return normalizePostsResponse(payload, author)
    },
  }
}

async function resolveUser(
  username: string,
  bearerToken: string,
  fetchImplementation: typeof globalThis.fetch,
  signal: AbortSignal,
  cache: Map<string, CachedUser>,
  cacheTtlMs: number,
  onResponse: XApiSourceOptions['onResponse'],
): Promise<XPostAuthor> {
  const cacheKey = username.toLowerCase()
  const cached = cache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.user
  }

  const url = new URL(
    `${X_API_BASE_URL}/users/by/username/${encodeURIComponent(username)}`,
  )
  url.searchParams.set('user.fields', USER_FIELDS)

  const payload = await requestJson(
    'user_lookup',
    url,
    bearerToken,
    fetchImplementation,
    signal,
    onResponse,
  )
  const user = normalizeUserResponse(payload)

  if (cacheTtlMs > 0) {
    cache.set(cacheKey, {
      expiresAt: Date.now() + cacheTtlMs,
      user,
    })
  }

  return user
}

function buildPostsUrl(
  userId: string,
  options: {
    excludeReplies: boolean
    excludeReposts: boolean
    postLimit: number
    sinceId: string | null
  },
): URL {
  const url = new URL(`${X_API_BASE_URL}/users/${userId}/tweets`)
  const exclude: string[] = []

  url.searchParams.set(
    'max_results',
    String(Math.max(5, Math.min(100, options.postLimit))),
  )
  url.searchParams.set('tweet.fields', POST_FIELDS)
  url.searchParams.set('expansions', 'attachments.media_keys')
  url.searchParams.set('media.fields', MEDIA_FIELDS)

  if (options.sinceId) {
    url.searchParams.set('since_id', options.sinceId)
  }

  if (options.excludeReplies) {
    exclude.push('replies')
  }

  if (options.excludeReposts) {
    exclude.push('retweets')
  }

  if (exclude.length > 0) {
    url.searchParams.set('exclude', exclude.join(','))
  }

  return url
}

async function requestJson(
  endpoint: XApiEndpoint,
  url: URL,
  bearerToken: string,
  fetchImplementation: typeof globalThis.fetch,
  signal: AbortSignal,
  onResponse: XApiSourceOptions['onResponse'],
): Promise<unknown> {
  const response = await fetchImplementation(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${bearerToken}`,
    },
    signal,
  })

  emitResponseInfo(onResponse, endpoint, response)

  const body = await response.text()
  let payload: unknown = null

  if (body.trim().length > 0) {
    try {
      payload = JSON.parse(body) as unknown
    } catch (error) {
      if (response.ok) {
        throw new XFeedError(
          'INVALID_RESPONSE',
          `X API ${endpoint} returned invalid JSON.`,
          {
            cause: error,
            sourceId: X_API_SOURCE_ID,
            status: response.status,
          },
        )
      }
    }
  }

  if (!response.ok) {
    throw createApiError(endpoint, response.status, payload)
  }

  return payload
}

function normalizeUserResponse(payload: unknown): XPostAuthor {
  if (!isRecord(payload)) {
    throw invalidResponse('user_lookup')
  }

  if (!isRecord(payload.data)) {
    const error = readFirstApiError(payload.errors)

    if (error) {
      throw createApiError('user_lookup', error.status ?? 404, payload)
    }

    throw invalidResponse('user_lookup')
  }

  const id = readXId(payload.data.id)
  const username = readRequiredString(payload.data.username, 50)
  const name = readRequiredString(payload.data.name, 256)

  if (!id || !username || !name) {
    throw invalidResponse('user_lookup')
  }

  return {
    id,
    username,
    name,
    profileImageUrl: readNullableString(payload.data.profile_image_url, 2_048),
    protected: readNullableBoolean(payload.data.protected),
    verified: readNullableBoolean(payload.data.verified),
  }
}

function normalizePostsResponse(
  payload: unknown,
  author: XPostAuthor,
): XPost[] {
  if (!isRecord(payload)) {
    throw invalidResponse('user_posts')
  }

  if (payload.data === undefined) {
    const error = readFirstApiError(payload.errors)

    if (error) {
      throw createApiError('user_posts', error.status ?? 502, payload)
    }

    return []
  }

  if (!Array.isArray(payload.data)) {
    throw invalidResponse('user_posts')
  }

  const media = normalizeMediaIncludes(payload.includes)

  return payload.data.map((post) => normalizeApiPost(post, author, media))
}

function normalizeApiPost(
  value: unknown,
  author: XPostAuthor,
  mediaByKey: ReadonlyMap<string, XPostMedia>,
): XPost {
  if (!isRecord(value)) {
    throw invalidResponse('user_posts')
  }

  const id = readXId(value.id)
  const text = typeof value.text === 'string' ? value.text.trim() : null
  const createdAt = readIsoDate(value.created_at)

  if (!id || text === null || !createdAt) {
    throw invalidResponse('user_posts')
  }

  const mediaKeys = readStringArrayFromRecord(value.attachments, 'media_keys')
  const references = normalizeReferences(value.referenced_tweets)

  return {
    id,
    source: 'x',
    kind: 'post',
    url: `https://x.com/${author.username}/status/${id}`,
    text,
    createdAt,
    language: readNullableString(value.lang, 64),
    conversationId: readNullableXId(value.conversation_id),
    author,
    metrics: normalizeMetrics(value.public_metrics),
    media: mediaKeys.flatMap((key) => {
      const item = mediaByKey.get(key)
      return item ? [item] : []
    }),
    references,
  }
}

function normalizeMetrics(value: unknown): XPost['metrics'] {
  const metrics = isRecord(value) ? value : {}

  return {
    replies: readCount(metrics.reply_count) ?? 0,
    reposts:
      readCount(metrics.retweet_count) ??
      readCount(metrics.repost_count) ??
      0,
    likes: readCount(metrics.like_count) ?? 0,
    quotes: readCount(metrics.quote_count) ?? 0,
    bookmarks: readCount(metrics.bookmark_count),
    impressions: readCount(metrics.impression_count),
  }
}

function normalizeMediaIncludes(value: unknown): Map<string, XPostMedia> {
  if (!isRecord(value) || value.media === undefined) {
    return new Map()
  }

  if (!Array.isArray(value.media)) {
    throw invalidResponse('user_posts')
  }

  const media = new Map<string, XPostMedia>()

  for (const entry of value.media) {
    if (!isRecord(entry)) {
      throw invalidResponse('user_posts')
    }

    const key = readRequiredString(entry.media_key, 128)
    const type = readMediaType(entry.type)

    if (!key || !type) {
      throw invalidResponse('user_posts')
    }

    media.set(key, {
      key,
      type,
      url: readNullableString(entry.url, 2_048),
      previewImageUrl: readNullableString(entry.preview_image_url, 2_048),
      altText: readNullableString(entry.alt_text, 5_000),
      width: readPositiveInteger(entry.width),
      height: readPositiveInteger(entry.height),
      durationMs: readCount(entry.duration_ms),
    })
  }

  return media
}

function normalizeReferences(value: unknown): XPostReference[] {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    throw invalidResponse('user_posts')
  }

  const references: XPostReference[] = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      throw invalidResponse('user_posts')
    }

    const postId = readXId(entry.id)
    const type = entry.type

    if (!postId) {
      throw invalidResponse('user_posts')
    }

    if (type === 'replied_to' || type === 'quoted') {
      references.push({ type, postId })
    } else if (type === 'retweeted' || type === 'reposted') {
      references.push({ type: 'reposted', postId })
    }
  }

  return references
}

function emitResponseInfo(
  onResponse: XApiSourceOptions['onResponse'],
  endpoint: XApiEndpoint,
  response: Response,
): void {
  if (!onResponse) {
    return
  }

  try {
    onResponse({
      endpoint,
      status: response.status,
      requestId: response.headers.get('x-request-id'),
      rateLimit: {
        limit: readHeaderInteger(response.headers, 'x-rate-limit-limit'),
        remaining: readHeaderInteger(
          response.headers,
          'x-rate-limit-remaining',
        ),
        resetAt: readRateLimitReset(response.headers),
      },
    })
  } catch {
    // Diagnostics must never break feed synchronization.
  }
}

function createApiError(
  endpoint: XApiEndpoint,
  status: number,
  payload: unknown,
): XFeedError {
  const apiError = isRecord(payload)
    ? readFirstApiError(payload.errors) ?? readLegacyApiError(payload)
    : null
  const detail = apiError?.detail ?? apiError?.title ?? null
  const suffix = detail ? `: ${detail}` : ''

  return new XFeedError(
    errorCodeForStatus(status),
    `X API ${endpoint} request failed with status ${status}${suffix}.`,
    {
      sourceId: X_API_SOURCE_ID,
      status,
    },
  )
}

function errorCodeForStatus(status: number): XFeedErrorCode {
  if (status === 401) {
    return 'AUTHENTICATION_FAILED'
  }

  if (status === 403) {
    return 'ACCESS_FORBIDDEN'
  }

  if (status === 404) {
    return 'NOT_FOUND'
  }

  if (status === 429) {
    return 'RATE_LIMITED'
  }

  return 'REQUEST_FAILED'
}

function readFirstApiError(value: unknown): {
  detail: string | null
  status: number | null
  title: string | null
} | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }

  const first = value[0]
  if (!isRecord(first)) {
    return null
  }

  return {
    detail: readNullableString(first.detail, 500),
    status: readCount(first.status),
    title: readNullableString(first.title, 200),
  }
}

function readLegacyApiError(value: Record<string, unknown>): {
  detail: string | null
  status: number | null
  title: string | null
} | null {
  const message = readNullableString(value.message, 500)

  return message
    ? {
        detail: message,
        status: readCount(value.code),
        title: null,
      }
    : null
}

function assertBearerToken(value: string): string {
  const token = typeof value === 'string' ? value.trim() : ''

  if (
    token.length === 0 ||
    token.length > 4_096 ||
    token.includes('\r') ||
    token.includes('\n')
  ) {
    throw invalidConfiguration('A valid X API bearer token is required.')
  }

  return token
}

function resolveUserCacheTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_USER_CACHE_TTL_MS

  if (!Number.isInteger(ttl) || ttl < 0 || ttl > MAX_USER_CACHE_TTL_MS) {
    throw invalidConfiguration(
      `userCacheTtlMs must be an integer between 0 and ${MAX_USER_CACHE_TTL_MS}.`,
    )
  }

  return ttl
}

function readHeaderInteger(headers: Headers, name: string): number | null {
  const value = headers.get(name)

  if (value === null || !/^\d+$/.test(value)) {
    return null
  }

  return Number(value)
}

function readRateLimitReset(headers: Headers): string | null {
  const epochSeconds = readHeaderInteger(headers, 'x-rate-limit-reset')

  if (epochSeconds === null) {
    return null
  }

  const date = new Date(epochSeconds * 1_000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function readStringArrayFromRecord(
  value: unknown,
  field: string,
): string[] {
  if (!isRecord(value) || value[field] === undefined) {
    return []
  }

  const list = value[field]
  if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) {
    throw invalidResponse('user_posts')
  }

  return list
}

function readMediaType(value: unknown): XPostMediaType | null {
  return value === 'photo' || value === 'video' || value === 'animated_gif'
    ? value
    : null
}

function readIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

function readXId(value: unknown): string | null {
  return typeof value === 'string' && X_ID_PATTERN.test(value) ? value : null
}

function readNullableXId(value: unknown): string | null {
  return value === null || value === undefined ? null : readXId(value)
}

function readRequiredString(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : null
}

function readNullableString(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length <= maximum ? normalized : null
}

function readNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readCount(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : null
}

function readPositiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0
    ? (value as number)
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function invalidConfiguration(message: string): XFeedError {
  return new XFeedError('INVALID_CONFIGURATION', message, {
    sourceId: X_API_SOURCE_ID,
  })
}

function invalidResponse(endpoint: XApiEndpoint): XFeedError {
  return new XFeedError(
    'INVALID_RESPONSE',
    `X API ${endpoint} returned an invalid response.`,
    { sourceId: X_API_SOURCE_ID },
  )
}
