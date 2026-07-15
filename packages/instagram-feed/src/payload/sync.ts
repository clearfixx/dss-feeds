import { createHash } from 'node:crypto'
import type { Payload } from 'payload'
import { fetchInstagramPosts } from '../instagram.js'
import {
  assertGraphVersion,
  assertInstagramUsername,
  assertResultLimit,
  assertSourceMode,
  assertTimeout,
  isSafeCachedMediaUrl,
} from '../security.js'
import {
  InstagramFeedError,
  type InstagramMediaMirror,
  type InstagramPost,
  type InstagramProviderPost,
  type InstagramSourceMode,
} from '../types.js'

export const INSTAGRAM_FEED_ADAPTER_VERSION = '0.2.0'

export type InstagramFeedSyncLogLevel = 'info' | 'success' | 'warning' | 'error'
export interface InstagramFeedSyncLogEntry {
  level: InstagramFeedSyncLogLevel
  message: string
  timestamp: string
  context?: Readonly<Record<string, unknown>>
}

export interface InstagramFeedSyncResult {
  status: 'success' | 'skipped'
  reason?: 'disabled' | 'not_due'
  cacheKey: string
  created: boolean
  changed: boolean
  postCount: number
  checksum: string | null
  generatedAt: string | null
  freshUntil: string | null
  staleUntil: string | null
  nextSyncAt: string | null
}

export interface SynchronizeInstagramFeedOptions {
  payload: Payload
  officialAccessToken?: string
  officialUserId?: string
  experimentalSessionId?: string
  experimentalCsrfToken?: string
  experimentalDsUserId?: string
  experimentalAppId?: string
  experimentalUserAgent?: string
  experimentalDocumentId?: string
  mediaMirror?: InstagramMediaMirror
  fetch?: typeof globalThis.fetch
  now?: Date
  force?: boolean
  settingsSlug?: string
  cacheSlug?: string
  cacheKey?: string
  onLog?: (entry: InstagramFeedSyncLogEntry) => void
}

interface SettingsRecord {
  enabled: boolean
  username: string
  sourceMode: InstagramSourceMode
  fetchLimit: number
  includeVideos: boolean
  syncIntervalHours: number
  freshForMinutes: number
  staleForHours: number
  graphVersion: string
  timeoutMs: number
}
interface SnapshotRecord {
  id: string | number
  checksum: string | null
  nextSyncAt: string | null
  posts: readonly InstagramPost[]
}
interface Client {
  findGlobal(args: { slug: string; overrideAccess: boolean }): Promise<unknown>
  find(args: { collection: string; where: { key: { equals: string } }; limit: number; depth: number; overrideAccess: boolean }): Promise<{ docs?: unknown[] }>
  create(args: { collection: string; data: Record<string, unknown>; overrideAccess: boolean }): Promise<unknown>
  update(args: { collection: string; id: string | number; data: Record<string, unknown>; overrideAccess: boolean }): Promise<unknown>
}

export async function synchronizeInstagramFeed(options: SynchronizeInstagramFeedOptions): Promise<InstagramFeedSyncResult> {
  const now = options.now ?? new Date()
  if (Number.isNaN(now.getTime())) throw new TypeError('synchronizeInstagramFeed now must be a valid Date.')

  const client = options.payload as unknown as Client
  const settingsSlug = options.settingsSlug ?? 'dss-instagram-feed-settings'
  const cacheSlug = options.cacheSlug ?? 'dss-instagram-feed-cache'
  const cacheKey = options.cacheKey ?? 'instagram:default'
  const rawSettings = await client.findGlobal({ slug: settingsSlug, overrideAccess: true })
  const enabled = isRecord(rawSettings) && rawSettings.enabled === true
  const existing = await findSnapshot(client, cacheSlug, cacheKey)

  if (!enabled) {
    log(options, 'info', 'Instagram feed synchronization is disabled.', now)
    return skippedResult('disabled', cacheKey, existing)
  }

  const settings = parseEnabledSettings(rawSettings)
  if (options.force !== true && existing?.nextSyncAt && now.getTime() < Date.parse(existing.nextSyncAt)) {
    log(options, 'info', 'Instagram feed synchronization is not due yet.', now)
    return skippedResult('not_due', cacheKey, existing)
  }

  const request = options.fetch ?? globalThis.fetch
  if (typeof request !== 'function') throw new InstagramFeedError('INVALID_CONFIGURATION', 'A Fetch API implementation is required.')
  if (!options.mediaMirror) {
    throw new InstagramFeedError('MEDIA_MIRROR_REQUIRED', 'Instagram feed requires a mediaMirror so public pages never load Instagram CDN media directly.')
  }

  log(options, 'info', `Fetching Instagram posts with ${settings.sourceMode}.`, now)
  const fetched = await fetchInstagramPosts(
    {
      username: settings.username,
      sourceMode: settings.sourceMode,
      fetchLimit: settings.fetchLimit,
      includeVideos: settings.includeVideos,
      timeoutMs: settings.timeoutMs,
      graphVersion: settings.graphVersion,
    },
    {
      fetch: request,
      official: { accessToken: options.officialAccessToken ?? '', userId: options.officialUserId ?? '' },
      experimental: {
        sessionId: options.experimentalSessionId ?? '',
        csrfToken: options.experimentalCsrfToken ?? '',
        dsUserId: options.experimentalDsUserId,
        appId: options.experimentalAppId ?? '',
        userAgent: options.experimentalUserAgent,
        documentId: options.experimentalDocumentId,
      },
    },
  )

  for (const warning of fetched.warnings) log(options, 'warning', warning, now)
  const mirrored = await mirrorPosts(
    fetched.posts,
    options.payload,
    options.mediaMirror,
    request,
    now,
    options.onLog,
  )
  if (mirrored.length === 0) {
    throw new InstagramFeedError('MEDIA_MIRROR_FAILED', 'No Instagram media could be mirrored into local storage.', { source: fetched.sourceUsed })
  }

  const merged = mergeSnapshots(mirrored, existing?.posts ?? [], settings.fetchLimit)
  const generatedAt = now.toISOString()
  const freshUntil = addMinutes(now, settings.freshForMinutes)
  const staleUntil = addHours(new Date(freshUntil), settings.staleForHours)
  const nextSyncAt = addHours(now, settings.syncIntervalHours)
  const checksum = checksumPosts(merged)
  const changed = existing?.checksum !== checksum
  const data = {
    key: cacheKey,
    username: settings.username,
    sourceMode: settings.sourceMode,
    sourceUsed: fetched.sourceUsed,
    posts: merged.map(toPayloadPost),
    checksum,
    adapterVersion: INSTAGRAM_FEED_ADAPTER_VERSION,
    generatedAt,
    freshUntil,
    staleUntil,
    nextSyncAt,
    warnings: fetched.warnings.map((message) => ({ message })),
  }

  let created = false
  if (existing) {
    await client.update({ collection: cacheSlug, id: existing.id, data, overrideAccess: true })
  } else {
    await client.create({ collection: cacheSlug, data, overrideAccess: true })
    created = true
  }

  log(options, 'success', `Instagram snapshot stored with ${merged.length} posts from ${fetched.sourceUsed}.`, now, { changed, sourceUsed: fetched.sourceUsed })
  return { status: 'success', cacheKey, created, changed, postCount: merged.length, checksum, generatedAt, freshUntil, staleUntil, nextSyncAt }
}

async function mirrorPosts(
  posts: readonly InstagramProviderPost[],
  payload: Payload,
  mirror: InstagramMediaMirror,
  request: typeof globalThis.fetch,
  now: Date,
  onLog?: (entry: InstagramFeedSyncLogEntry) => void,
): Promise<InstagramPost[]> {
  const output: InstagramPost[] = []
  for (const post of posts) {
    try {
      const result = await mirror({ payload, post, fetch: request })
      const imageUrl = result.imageUrl.trim()
      const thumbnailUrl = result.thumbnailUrl?.trim() || null
      if (!isSafeCachedMediaUrl(imageUrl) || (thumbnailUrl && !isSafeCachedMediaUrl(thumbnailUrl))) {
        throw new InstagramFeedError('MEDIA_MIRROR_FAILED', 'The media mirror must return local or non-Instagram HTTPS URLs.')
      }
      output.push({ ...post, source: 'instagram', kind: 'post', imageUrl, thumbnailUrl })
    } catch (error) {
      onLog?.({
        level: 'warning',
        message: `Instagram media ${post.id} could not be mirrored: ${readErrorMessage(error)}`,
        timestamp: now.toISOString(),
        context: { postId: post.id },
      })
    }
  }
  return output
}

async function findSnapshot(client: Client, cacheSlug: string, cacheKey: string): Promise<SnapshotRecord | null> {
  const result = await client.find({
    collection: cacheSlug,
    where: { key: { equals: cacheKey } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const value = result.docs?.[0]
  if (!isRecord(value) || (typeof value.id !== 'string' && typeof value.id !== 'number')) return null
  return {
    id: value.id,
    checksum: readString(value.checksum),
    nextSyncAt: readDate(value.nextSyncAt),
    posts: readExistingPosts(value.posts),
  }
}

function parseEnabledSettings(value: unknown): SettingsRecord {
  if (!isRecord(value)) throw new InstagramFeedError('INVALID_CONFIGURATION', 'Instagram settings global is unavailable.')
  return {
    enabled: true,
    username: assertInstagramUsername(requireString(value.username, 'Instagram username')),
    sourceMode: assertSourceMode(requireString(value.sourceMode, 'Instagram source mode')),
    fetchLimit: assertResultLimit(readNumber(value.fetchLimit)),
    includeVideos: value.includeVideos === true,
    syncIntervalHours: boundedInteger(value.syncIntervalHours, 1, 24, 6, 'Synchronization interval'),
    freshForMinutes: boundedInteger(value.freshForMinutes, 15, 1440, 390, 'Fresh cache lifetime'),
    staleForHours: boundedInteger(value.staleForHours, 1, 720, 168, 'Stale fallback lifetime'),
    graphVersion: assertGraphVersion(readString(value.graphVersion) ?? undefined),
    timeoutMs: assertTimeout(readNumber(value.timeoutMs)),
  }
}

function mergeSnapshots(fresh: readonly InstagramPost[], previous: readonly InstagramPost[], limit: number): InstagramPost[] {
  const unique = new Map<string, InstagramPost>()
  for (const post of [...fresh, ...previous]) if (!unique.has(post.id)) unique.set(post.id, post)
  return [...unique.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, limit)
}

function readExistingPosts(value: unknown): InstagramPost[] {
  if (!Array.isArray(value)) return []
  return value.map((entry): InstagramPost | null => {
    if (!isRecord(entry)) return null
    const id = readString(entry.externalId)
    const imageUrl = readString(entry.imageUrl)
    const providerImageUrl = readString(entry.providerImageUrl)
    const permalink = readString(entry.permalink)
    const publishedAt = readDate(entry.publishedAt)
    const username = readString(entry.username)
    const mediaType = entry.mediaType === 'image' || entry.mediaType === 'carousel' || entry.mediaType === 'video' ? entry.mediaType : null
    if (!id || !imageUrl || !providerImageUrl || !permalink || !publishedAt || !username || !mediaType) return null
    return {
      id, source: 'instagram', kind: 'post', shortcode: readString(entry.shortcode), mediaType,
      mediaProductType: readString(entry.mediaProductType), imageUrl, thumbnailUrl: readString(entry.thumbnailUrl),
      providerImageUrl, providerThumbnailUrl: readString(entry.providerThumbnailUrl), permalink,
      caption: readString(entry.caption), publishedAt, likeCount: readCount(entry.likeCount),
      commentCount: readCount(entry.commentCount), username, width: readPositiveInteger(entry.width), height: readPositiveInteger(entry.height),
    }
  }).filter((post): post is InstagramPost => post !== null)
}

function toPayloadPost(post: InstagramPost): Record<string, unknown> {
  return {
    externalId: post.id, shortcode: post.shortcode, mediaType: post.mediaType,
    mediaProductType: post.mediaProductType, imageUrl: post.imageUrl, thumbnailUrl: post.thumbnailUrl,
    providerImageUrl: post.providerImageUrl, providerThumbnailUrl: post.providerThumbnailUrl,
    permalink: post.permalink, caption: post.caption, publishedAt: post.publishedAt,
    likeCount: post.likeCount, commentCount: post.commentCount, username: post.username,
    width: post.width, height: post.height,
  }
}

function checksumPosts(posts: readonly InstagramPost[]): string {
  return createHash('sha256').update(JSON.stringify(posts.map((post) => ({
    id: post.id, imageUrl: post.imageUrl, permalink: post.permalink,
    publishedAt: post.publishedAt, likeCount: post.likeCount, commentCount: post.commentCount,
  })))).digest('hex')
}

function skippedResult(reason: 'disabled' | 'not_due', cacheKey: string, existing: SnapshotRecord | null): InstagramFeedSyncResult {
  return {
    status: 'skipped', reason, cacheKey, created: false, changed: false,
    postCount: existing?.posts.length ?? 0, checksum: existing?.checksum ?? null,
    generatedAt: null, freshUntil: null, staleUntil: null, nextSyncAt: existing?.nextSyncAt ?? null,
  }
}
function log(options: SynchronizeInstagramFeedOptions, level: InstagramFeedSyncLogLevel, message: string, now: Date, context?: Readonly<Record<string, unknown>>): void {
  options.onLog?.({ level, message, timestamp: now.toISOString(), ...(context ? { context } : {}) })
}
function addMinutes(date: Date, minutes: number): string { return new Date(date.getTime() + minutes * 60_000).toISOString() }
function addHours(date: Date, hours: number): string { return new Date(date.getTime() + hours * 3_600_000).toISOString() }
function requireString(value: unknown, label: string): string {
  const result = readString(value)
  if (!result) throw new InstagramFeedError('INVALID_CONFIGURATION', `${label} is required.`)
  return result
}
function readString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function readDate(value: unknown): string | null {
  const raw = readString(value)
  if (!raw) return null
  const timestamp = Date.parse(raw)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}
function readNumber(value: unknown): number | undefined { return typeof value === 'number' ? value : undefined }
function boundedInteger(value: unknown, min: number, max: number, fallback: number, label: string): number {
  const result = typeof value === 'number' ? value : fallback
  if (!Number.isInteger(result) || result < min || result > max) throw new InstagramFeedError('INVALID_CONFIGURATION', `${label} must be an integer between ${min} and ${max}.`)
  return result
}
function readCount(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null }
function readPositiveInteger(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null }
function readErrorMessage(error: unknown): string { return error instanceof Error && error.message.trim() ? error.message.trim() : 'Unknown media mirror error.' }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
