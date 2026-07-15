import type { Payload } from 'payload'
import { isSafeCachedMediaUrl, isSafeInstagramPermalink } from '../security.js'
import type { InstagramMediaType, InstagramPost, InstagramSource } from '../types.js'

export type InstagramFeedCacheState = 'empty' | 'fresh' | 'stale' | 'expired' | 'unavailable'

export interface InstagramFeedReadResult {
  state: InstagramFeedCacheState
  renderable: boolean
  cachedPostCount: number
  posts: readonly InstagramPost[]
  sourceUsed: InstagramSource | null
  checksum: string | null
  adapterVersion: string | null
  generatedAt: string | null
  freshUntil: string | null
  staleUntil: string | null
  nextSyncAt: string | null
  warnings: readonly string[]
}

export interface ReadInstagramFeedOptions {
  payload: Payload
  cacheSlug?: string
  cacheKey?: string
  postLimit?: number
  now?: Date
}

interface Client {
  find(args: {
    collection: string
    where: { key: { equals: string } }
    limit: number
    depth: number
    overrideAccess: boolean
  }): Promise<{ docs?: unknown[] }>
}

export async function readInstagramFeed(options: ReadInstagramFeedOptions): Promise<InstagramFeedReadResult> {
  const now = options.now ?? new Date()
  if (Number.isNaN(now.getTime())) throw new TypeError('readInstagramFeed now must be a valid Date.')

  let result: { docs?: unknown[] }
  try {
    result = await (options.payload as unknown as Client).find({
      collection: options.cacheSlug ?? 'dss-instagram-feed-cache',
      where: { key: { equals: options.cacheKey ?? 'instagram:default' } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    return emptyResult('unavailable', ['Instagram cache could not be read.'])
  }

  const snapshot = result.docs?.[0]
  if (!isRecord(snapshot)) return emptyResult('empty', [])

  const generatedAt = readDate(snapshot.generatedAt)
  const freshUntil = readDate(snapshot.freshUntil)
  const staleUntil = readDate(snapshot.staleUntil)
  const nextSyncAt = readDate(snapshot.nextSyncAt)
  const posts = readPosts(snapshot.posts)
  const warnings = readWarnings(snapshot.warnings)
  const state = resolveState(now, posts.length, freshUntil, staleUntil)
  const postLimit = options.postLimit === undefined ? posts.length : normalizePostLimit(options.postLimit)
  const visiblePosts = posts.slice(0, postLimit)

  if (state === 'stale') warnings.push('Instagram snapshot is stale; the last successful cache is being rendered.')
  if (state === 'expired') warnings.push('Instagram snapshot is expired; static application fallback is recommended.')

  return {
    state,
    renderable: visiblePosts.length > 0 && state !== 'expired',
    cachedPostCount: posts.length,
    posts: visiblePosts,
    sourceUsed: readSource(snapshot.sourceUsed),
    checksum: readString(snapshot.checksum),
    adapterVersion: readString(snapshot.adapterVersion),
    generatedAt,
    freshUntil,
    staleUntil,
    nextSyncAt,
    warnings,
  }
}

function readPosts(value: unknown): InstagramPost[] {
  if (!Array.isArray(value)) return []
  return value.map(readPost).filter((post): post is InstagramPost => post !== null)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
}

function readPost(value: unknown): InstagramPost | null {
  if (!isRecord(value)) return null
  const id = readString(value.externalId)
  const mediaType = readMediaType(value.mediaType)
  const imageUrl = readString(value.imageUrl)
  const permalink = readString(value.permalink)
  const publishedAt = readDate(value.publishedAt)
  const username = readString(value.username)
  const providerImageUrl = readString(value.providerImageUrl)
  if (!id || !mediaType || !imageUrl || !permalink || !publishedAt || !username || !providerImageUrl) return null
  if (!isSafeCachedMediaUrl(imageUrl) || !isSafeInstagramPermalink(permalink)) return null

  const thumbnailUrl = readString(value.thumbnailUrl)
  return {
    id,
    source: 'instagram',
    kind: 'post',
    shortcode: readString(value.shortcode),
    mediaType,
    mediaProductType: readString(value.mediaProductType),
    imageUrl,
    thumbnailUrl: thumbnailUrl && isSafeCachedMediaUrl(thumbnailUrl) ? thumbnailUrl : null,
    providerImageUrl,
    providerThumbnailUrl: readString(value.providerThumbnailUrl),
    permalink,
    caption: readString(value.caption),
    publishedAt,
    likeCount: readCount(value.likeCount),
    commentCount: readCount(value.commentCount),
    username,
    width: readPositiveInteger(value.width),
    height: readPositiveInteger(value.height),
  }
}

function resolveState(now: Date, postCount: number, freshUntil: string | null, staleUntil: string | null): InstagramFeedCacheState {
  if (postCount === 0) return 'empty'
  if (!freshUntil || !staleUntil) return 'expired'
  if (now.getTime() <= Date.parse(freshUntil)) return 'fresh'
  if (now.getTime() <= Date.parse(staleUntil)) return 'stale'
  return 'expired'
}

function emptyResult(state: InstagramFeedCacheState, warnings: readonly string[]): InstagramFeedReadResult {
  return {
    state, renderable: false, cachedPostCount: 0, posts: [], sourceUsed: null,
    checksum: null, adapterVersion: null, generatedAt: null, freshUntil: null,
    staleUntil: null, nextSyncAt: null, warnings,
  }
}

function readWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => isRecord(entry) ? readString(entry.message) : null).filter((item): item is string => item !== null)
}
function readSource(value: unknown): InstagramSource | null { return value === 'official' || value === 'experimental-web-session' ? value : null }
function readMediaType(value: unknown): InstagramMediaType | null { return value === 'image' || value === 'carousel' || value === 'video' ? value : null }
function readDate(value: unknown): string | null {
  const raw = readString(value)
  if (!raw) return null
  const timestamp = Date.parse(raw)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}
function readCount(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null }
function readPositiveInteger(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null }
function readString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function normalizePostLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 50) throw new RangeError('postLimit must be an integer between 1 and 50.')
  return value
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
