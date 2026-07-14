import {
  XFeedError,
  type XPost,
  type XPostAuthor,
  type XPostMedia,
  type XPostMediaType,
  type XPostMetrics,
  type XPostReference,
  type XPostReferenceType,
} from './types.js'
const X_ID_PATTERN = /^[0-9]{1,19}$/
const X_USERNAME_PATTERN = /^[A-Za-z0-9_]+$/
const MEDIA_TYPES = new Set<XPostMediaType>([
  'photo',
  'video',
  'animated_gif',
])
const REFERENCE_TYPES = new Set<XPostReferenceType>([
  'replied_to',
  'quoted',
  'reposted',
])

export function normalizeXPost(value: unknown, sourceId: string): XPost {
  if (!isRecord(value)) {
    throw invalidPost(sourceId)
  }

  const id = readXId(value.id)
  const source = value.source
  const kind = value.kind
  const text = typeof value.text === 'string' ? value.text.trim() : null
  const url = readXPostUrl(value.url, id)
  const createdAt = readIsoDate(value.createdAt)
  const language = readNullableString(value.language, 64)
  const conversationId = readNullableXId(value.conversationId)
  const author = normalizeAuthor(value.author, sourceId)
  const metrics = normalizeMetrics(value.metrics, sourceId)
  const media = normalizeMedia(value.media, sourceId)
  const references = normalizeReferences(value.references, sourceId)

  if (
    !id ||
    source !== 'x' ||
    kind !== 'post' ||
    text === null ||
    !url ||
    !createdAt
  ) {
    throw invalidPost(sourceId)
  }

  return {
    id,
    source: 'x',
    kind: 'post',
    url,
    text,
    createdAt,
    language,
    conversationId,
    author,
    metrics,
    media,
    references,
  }
}

function normalizeAuthor(value: unknown, sourceId: string): XPostAuthor {
  if (!isRecord(value)) {
    throw invalidPost(sourceId)
  }

  const id = readXId(value.id)
  const username = readXUsername(value.username)
  const name = readRequiredString(value.name, 256)
  const profileImageUrl = readNullableHttpsUrl(value.profileImageUrl)
  const verified = readNullableBoolean(value.verified)
  const protectedAccount = readNullableBoolean(value.protected)

  if (!id || !username || !name) {
    throw invalidPost(sourceId)
  }

  return {
    id,
    username,
    name,
    profileImageUrl,
    verified,
    protected: protectedAccount,
  }
}

function normalizeMetrics(value: unknown, sourceId: string): XPostMetrics {
  if (!isRecord(value)) {
    throw invalidPost(sourceId)
  }

  return {
    replies: readNonNegativeInteger(value.replies, sourceId),
    reposts: readNonNegativeInteger(value.reposts, sourceId),
    likes: readNonNegativeInteger(value.likes, sourceId),
    quotes: readNonNegativeInteger(value.quotes, sourceId),
    bookmarks: readNullableNonNegativeInteger(value.bookmarks, sourceId),
    impressions: readNullableNonNegativeInteger(value.impressions, sourceId),
  }
}

function normalizeMedia(value: unknown, sourceId: string): XPostMedia[] {
  if (!Array.isArray(value)) {
    throw invalidPost(sourceId)
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw invalidPost(sourceId)
    }

    const key = readRequiredString(entry.key, 128)
    const type = MEDIA_TYPES.has(entry.type as XPostMediaType)
      ? (entry.type as XPostMediaType)
      : null

    if (!key || !type) {
      throw invalidPost(sourceId)
    }

    return {
      key,
      type,
      url: readNullableHttpsUrl(entry.url),
      previewImageUrl: readNullableHttpsUrl(entry.previewImageUrl),
      altText: readNullableString(entry.altText, 5_000),
      width: readNullablePositiveInteger(entry.width, sourceId),
      height: readNullablePositiveInteger(entry.height, sourceId),
      durationMs: readNullableNonNegativeInteger(entry.durationMs, sourceId),
    }
  })
}

function normalizeReferences(
  value: unknown,
  sourceId: string,
): XPostReference[] {
  if (!Array.isArray(value)) {
    throw invalidPost(sourceId)
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw invalidPost(sourceId)
    }

    const type = REFERENCE_TYPES.has(entry.type as XPostReferenceType)
      ? (entry.type as XPostReferenceType)
      : null
    const postId = readXId(entry.postId)

    if (!type || !postId) {
      throw invalidPost(sourceId)
    }

    return { type, postId }
  })
}

function readXUsername(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().replace(/^@/, '')
  return normalized.length > 0 &&
    normalized.length <= 50 &&
    X_USERNAME_PATTERN.test(normalized)
    ? normalized
    : null
}

function readXPostUrl(value: unknown, id: string | null): string | null {
  if (typeof value !== 'string' || !id) {
    return null
  }

  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()

    if (
      url.protocol !== 'https:' ||
      (hostname !== 'x.com' &&
        hostname !== 'www.x.com' &&
        hostname !== 'twitter.com' &&
        hostname !== 'www.twitter.com') ||
      !url.pathname.endsWith(`/status/${id}`)
    ) {
      return null
    }

    return url.toString()
  } catch {
    return null
  }
}

function readNullableHttpsUrl(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function readIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

function readXId(value: unknown): string | null {
  return typeof value === 'string' && X_ID_PATTERN.test(value)
    ? value
    : null
}

function readNullableXId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  return readXId(value)
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

function readNonNegativeInteger(value: unknown, sourceId: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw invalidPost(sourceId)
  }

  return value as number
}

function readNullableNonNegativeInteger(
  value: unknown,
  sourceId: string,
): number | null {
  if (value === null || value === undefined) {
    return null
  }

  return readNonNegativeInteger(value, sourceId)
}

function readNullablePositiveInteger(
  value: unknown,
  sourceId: string,
): number | null {
  if (value === null || value === undefined) {
    return null
  }

  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw invalidPost(sourceId)
  }

  return value as number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function invalidPost(sourceId: string): XFeedError {
  return new XFeedError(
    'INVALID_RESPONSE',
    `X feed source "${sourceId}" returned an invalid post record.`,
    { sourceId },
  )
}
