import { assertGraphVersion, assertHttpsUrl, assertInstagramUsername, assertResultLimit, assertTimeout } from './security.js'
import { InstagramFeedError, type InstagramFeedConfig, type InstagramFeedRequestOptions, type InstagramProviderPost } from './types.js'

const GRAPH_BASE_URL = 'https://graph.instagram.com'
const USER_AGENT = '@dss-feeds/instagram-feed'

type RecordValue = Record<string, unknown>

export async function fetchOfficialInstagramPosts(
  config: InstagramFeedConfig,
  options: InstagramFeedRequestOptions = {},
): Promise<InstagramProviderPost[]> {
  const username = assertInstagramUsername(config.username)
  const limit = assertResultLimit(config.fetchLimit)
  const timeoutMs = assertTimeout(config.timeoutMs)
  const graphVersion = assertGraphVersion(config.graphVersion)
  const credentials = options.official
  const request = options.fetch ?? globalThis.fetch

  if (!credentials?.accessToken.trim() || !credentials.userId.trim()) {
    throw new InstagramFeedError('AUTHENTICATION_REQUIRED', 'Official Instagram source requires an access token and Instagram user ID.', { source: 'official' })
  }
  if (typeof request !== 'function') {
    throw new InstagramFeedError('INVALID_CONFIGURATION', 'A Fetch API implementation is required.', { source: 'official' })
  }

  const url = new URL(`/${graphVersion}/${encodeURIComponent(credentials.userId.trim())}/media`, GRAPH_BASE_URL)
  url.searchParams.set('fields', [
    'id', 'caption', 'comments_count', 'like_count', 'media_type', 'media_product_type',
    'media_url', 'permalink', 'thumbnail_url', 'timestamp', 'username',
    'children{id,media_type,media_url,thumbnail_url}',
  ].join(','))
  url.searchParams.set('limit', String(limit))

  const timeout = createRequestSignal(timeoutMs, options.signal)
  let response: Response
  try {
    response = await request(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credentials.accessToken.trim()}`,
        'User-Agent': USER_AGENT,
      },
      signal: timeout.signal,
    })
  } catch (error) {
    timeout.dispose()
    throw new InstagramFeedError(timeout.signal.aborted ? 'REQUEST_ABORTED' : 'REQUEST_FAILED', timeout.signal.aborted ? 'Instagram official API request was aborted.' : 'Instagram official API request failed.', { cause: error, source: 'official' })
  }
  timeout.dispose()

  if (!response.ok) {
    throw new InstagramFeedError(response.status === 401 || response.status === 403 ? 'AUTHENTICATION_REQUIRED' : 'REQUEST_FAILED', `Instagram official API returned HTTP ${response.status}.`, { source: 'official', status: response.status })
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new InstagramFeedError('INVALID_RESPONSE', 'Instagram official API returned invalid JSON.', { cause: error, source: 'official', status: response.status })
  }

  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new InstagramFeedError('INVALID_RESPONSE', 'Instagram official API returned an unexpected media response.', { source: 'official', status: response.status })
  }

  return deduplicateAndSort(payload.data
    .map((entry) => normalizeOfficialPost(entry, username, config.includeVideos === true))
    .filter((post): post is InstagramProviderPost => post !== null))
    .slice(0, limit)
}

function normalizeOfficialPost(value: unknown, configuredUsername: string, includeVideos: boolean): InstagramProviderPost | null {
  if (!isRecord(value)) throw invalidMedia()
  const id = readString(value.id)
  const apiMediaType = readString(value.media_type)
  const permalink = assertHttpsUrl(value.permalink, 'Instagram permalink')
  const publishedAt = normalizeDate(value.timestamp)
  const username = readString(value.username) ?? configuredUsername
  if (!id || !apiMediaType || !publishedAt) throw invalidMedia()
  if (apiMediaType === 'VIDEO' && !includeVideos) return null

  const mediaType = apiMediaType === 'CAROUSEL_ALBUM' ? 'carousel' : apiMediaType === 'VIDEO' ? 'video' : apiMediaType === 'IMAGE' ? 'image' : null
  if (!mediaType) return null
  const media = selectMedia(value, mediaType)
  if (!media.imageUrl) throw invalidMedia()

  return {
    id,
    shortcode: readShortcode(permalink),
    mediaType,
    mediaProductType: readString(value.media_product_type),
    providerImageUrl: assertHttpsUrl(media.imageUrl, 'Instagram media URL'),
    providerThumbnailUrl: media.thumbnailUrl ? assertHttpsUrl(media.thumbnailUrl, 'Instagram thumbnail URL') : null,
    permalink,
    caption: readString(value.caption),
    publishedAt,
    likeCount: readCount(value.like_count),
    commentCount: readCount(value.comments_count),
    username,
    width: null,
    height: null,
  }
}

function selectMedia(record: RecordValue, mediaType: InstagramProviderPost['mediaType']): { imageUrl: string | null; thumbnailUrl: string | null } {
  if (mediaType === 'video') {
    return { imageUrl: readString(record.thumbnail_url) ?? readString(record.media_url), thumbnailUrl: readString(record.thumbnail_url) }
  }
  if (mediaType === 'carousel') {
    const children = isRecord(record.children) ? record.children.data : undefined
    if (Array.isArray(children)) {
      for (const child of children) {
        if (!isRecord(child)) continue
        const childType = readString(child.media_type)
        const mediaUrl = childType === 'VIDEO' ? readString(child.thumbnail_url) : readString(child.media_url)
        if (mediaUrl) return { imageUrl: mediaUrl, thumbnailUrl: readString(child.thumbnail_url) }
      }
    }
  }
  return { imageUrl: readString(record.media_url), thumbnailUrl: readString(record.thumbnail_url) }
}

function invalidMedia(): InstagramFeedError {
  return new InstagramFeedError('INVALID_RESPONSE', 'Instagram official API returned an invalid media record.', { source: 'official' })
}
function readShortcode(permalink: string): string | null { return permalink.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] ?? null }
function normalizeDate(value: unknown): string | null {
  const raw = readString(value)
  if (!raw) return null
  const timestamp = Date.parse(raw)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}
function readCount(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null }
function readString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function isRecord(value: unknown): value is RecordValue { return typeof value === 'object' && value !== null }
function deduplicateAndSort(posts: readonly InstagramProviderPost[]): InstagramProviderPost[] {
  const unique = new Map(posts.map((post) => [post.id, post]))
  return [...unique.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
}
function createRequestSignal(timeoutMs: number, externalSignal?: AbortSignal): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      externalSignal.addEventListener('abort', abort, { once: true })
    }
  }
  return { signal: controller.signal, dispose() { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort) } }
}
