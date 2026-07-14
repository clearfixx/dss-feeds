import { normalizeXPost } from './normalize.js'
import { assertXUsername } from './security.js'
import { getXFeedSourceMetadata } from './source-metadata.js'
import {
  XFeedError,
  type XFeedSource,
  type XFeedSourceMetadata,
  type XPost,
} from './types.js'

export const X_FEED_SNAPSHOT_VERSION = 1
export const X_FEED_ADAPTER_VERSION = '0.0.0'

export type XFeedCacheState =
  | 'empty'
  | 'fresh'
  | 'stale'
  | 'expired'
  | 'invalid'
  | 'unavailable'

export interface XFeedCachePolicy {
  /** Duration for which a successful snapshot is considered fresh. */
  freshForMs?: number
  /** Additional duration for which a stale snapshot remains renderable. */
  staleForMs?: number
  /** Minimum interval between successful synchronization attempts. */
  syncIntervalMs?: number
}

export interface ResolvedXFeedCachePolicy {
  freshForMs: number
  staleForMs: number
  syncIntervalMs: number
}

export interface XFeedSnapshotSource extends XFeedSourceMetadata {
  id: string
}

export interface XFeedSnapshot {
  schemaVersion: typeof X_FEED_SNAPSHOT_VERSION
  key: string
  username: string
  posts: readonly XPost[]
  checksum: string
  source: XFeedSnapshotSource
  adapterVersion: string
  generatedAt: string
  freshUntil: string
  staleUntil: string
  nextSyncAt: string
  warnings: readonly string[]
}

/**
 * Persistence boundary for any database, CMS, KV store, file, or memory cache.
 * Reads return unknown deliberately so persisted data is validated at runtime.
 */
export interface XFeedSnapshotStore {
  read(key: string): Promise<unknown | null>
  write(snapshot: XFeedSnapshot): Promise<void>
}

export interface XFeedReadOptions {
  store: XFeedSnapshotStore
  key: string
  postCount?: number
  order?: 'asc' | 'desc'
  now?: Date
}

export interface XFeedReadResult {
  state: XFeedCacheState
  renderable: boolean
  cachedPostCount: number
  posts: readonly XPost[]
  checksum: string | null
  source: XFeedSnapshotSource | null
  adapterVersion: string | null
  generatedAt: string | null
  freshUntil: string | null
  staleUntil: string | null
  nextSyncAt: string | null
  warnings: readonly string[]
}

const DEFAULT_FRESH_FOR_MS = 90 * 60 * 1000
const DEFAULT_STALE_FOR_MS = 24 * 60 * 60 * 1000
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000
const MIN_DURATION_MS = 60 * 1000
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_POST_COUNT = 5
const MAX_POST_COUNT = 100
const CACHE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/

export function resolveXFeedCachePolicy(
  policy: XFeedCachePolicy = {},
): ResolvedXFeedCachePolicy {
  return {
    freshForMs: readDuration(
      policy.freshForMs,
      DEFAULT_FRESH_FOR_MS,
      'freshForMs',
    ),
    staleForMs: readDuration(
      policy.staleForMs,
      DEFAULT_STALE_FOR_MS,
      'staleForMs',
    ),
    syncIntervalMs: readDuration(
      policy.syncIntervalMs,
      DEFAULT_SYNC_INTERVAL_MS,
      'syncIntervalMs',
    ),
  }
}

export function createXFeedCacheKey(username: string): string {
  return `x:${assertXUsername(username).toLowerCase()}`
}

export function assertXFeedCacheKey(key: string): string {
  const normalized = typeof key === 'string' ? key.trim() : ''

  if (!CACHE_KEY_PATTERN.test(normalized)) {
    throw new XFeedError(
      'INVALID_CONFIGURATION',
      'X feed cache key is invalid.',
    )
  }

  return normalized
}

export function createXFeedSnapshotSource(
  source: XFeedSource,
): XFeedSnapshotSource {
  return {
    id: source.id,
    ...getXFeedSourceMetadata(source),
  }
}

export function createXPostChecksum(posts: readonly XPost[]): string {
  const serialized = JSON.stringify(
    posts.map((post) => ({
      id: post.id,
      url: post.url,
      text: post.text,
      createdAt: post.createdAt,
      language: post.language,
      conversationId: post.conversationId,
      author: post.author,
      metrics: post.metrics,
      media: [...post.media].sort((left, right) =>
        left.key.localeCompare(right.key),
      ),
      references: [...post.references].sort((left, right) =>
        `${left.type}:${left.postId}`.localeCompare(
          `${right.type}:${right.postId}`,
        ),
      ),
    })),
  )

  // FNV-1a 64-bit is deterministic, dependency-free, and sufficient for
  // change detection. It is not exposed as a security primitive.
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn

  for (const byte of new TextEncoder().encode(serialized)) {
    hash ^= BigInt(byte)
    hash = (hash * prime) & mask
  }

  return hash.toString(16).padStart(16, '0')
}

export function mergeXPosts(
  existing: readonly XPost[],
  incoming: readonly XPost[],
  limit: number,
): XPost[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_POST_COUNT) {
    throw new RangeError(
      `limit must be an integer between 1 and ${MAX_POST_COUNT}.`,
    )
  }

  const merged = new Map<string, XPost>()

  for (const post of existing) {
    merged.set(post.id, post)
  }

  for (const post of incoming) {
    const previous = merged.get(post.id)
    merged.set(post.id, previous ? mergeXPost(previous, post) : post)
  }

  return [...merged.values()]
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )
    .slice(0, limit)
}

export function findLatestXPostId(posts: readonly XPost[]): string | null {
  let latest: bigint | null = null
  let latestId: string | null = null

  for (const post of posts) {
    try {
      const value = BigInt(post.id)
      if (latest === null || value > latest) {
        latest = value
        latestId = post.id
      }
    } catch {
      // Normalized X IDs are numeric. Ignore corrupted persisted entries here;
      // snapshot parsing will reject them when reading from storage.
    }
  }

  return latestId
}

export async function readXFeedSnapshot(
  options: XFeedReadOptions,
): Promise<XFeedReadResult> {
  const now = options.now ?? new Date()
  assertValidDate(now, 'now')
  const key = assertXFeedCacheKey(options.key)
  const postCount = normalizePostCount(options.postCount)
  const order = options.order ?? 'desc'

  let rawSnapshot: unknown
  try {
    rawSnapshot = await options.store.read(key)
  } catch {
    return createEmptyReadResult('unavailable')
  }

  if (rawSnapshot === null || rawSnapshot === undefined) {
    return createEmptyReadResult('empty')
  }

  const snapshot = parseXFeedSnapshot(rawSnapshot)
  if (!snapshot || snapshot.key !== key) {
    return createEmptyReadResult('invalid')
  }

  const state = resolveXFeedCacheState(snapshot, now)
  const renderable = state === 'fresh' || state === 'stale'
  const posts = renderable
    ? [...snapshot.posts]
        .sort((left, right) => {
          const difference =
            Date.parse(left.createdAt) - Date.parse(right.createdAt)
          return order === 'asc' ? difference : -difference
        })
        .slice(0, postCount)
    : []

  return {
    state,
    renderable: posts.length > 0,
    cachedPostCount: snapshot.posts.length,
    posts,
    checksum: snapshot.checksum,
    source: snapshot.source,
    adapterVersion: snapshot.adapterVersion,
    generatedAt: snapshot.generatedAt,
    freshUntil: snapshot.freshUntil,
    staleUntil: snapshot.staleUntil,
    nextSyncAt: snapshot.nextSyncAt,
    warnings: snapshot.warnings,
  }
}

export function resolveXFeedCacheState(
  timing: Pick<XFeedSnapshot, 'freshUntil' | 'staleUntil'>,
  now: Date = new Date(),
): 'fresh' | 'stale' | 'expired' {
  const nowTimestamp = now.getTime()
  const freshUntil = Date.parse(timing.freshUntil)
  const staleUntil = Date.parse(timing.staleUntil)

  if (
    Number.isNaN(nowTimestamp) ||
    Number.isNaN(freshUntil) ||
    Number.isNaN(staleUntil) ||
    staleUntil < freshUntil
  ) {
    return 'expired'
  }

  if (nowTimestamp <= freshUntil) {
    return 'fresh'
  }

  if (nowTimestamp <= staleUntil) {
    return 'stale'
  }

  return 'expired'
}

export function parseXFeedSnapshot(value: unknown): XFeedSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== X_FEED_SNAPSHOT_VERSION) {
    return null
  }

  const key = readRequiredString(value.key)
  const username = readRequiredString(value.username)
  const checksum = readRequiredString(value.checksum)
  const adapterVersion = readRequiredString(value.adapterVersion)
  const generatedAt = readDate(value.generatedAt)
  const freshUntil = readDate(value.freshUntil)
  const staleUntil = readDate(value.staleUntil)
  const nextSyncAt = readDate(value.nextSyncAt)
  const source = parseSnapshotSource(value.source)

  if (
    !key ||
    !CACHE_KEY_PATTERN.test(key) ||
    !username ||
    !checksum ||
    !adapterVersion ||
    !generatedAt ||
    !freshUntil ||
    !staleUntil ||
    !nextSyncAt ||
    !source ||
    !Array.isArray(value.posts)
  ) {
    return null
  }

  try {
    const posts = value.posts.map((post) => normalizeXPost(post, source.id))
    if (createXPostChecksum(posts) !== checksum) {
      return null
    }
    const warnings = readWarnings(value.warnings)

    return {
      schemaVersion: X_FEED_SNAPSHOT_VERSION,
      key,
      username,
      posts,
      checksum,
      source,
      adapterVersion,
      generatedAt,
      freshUntil,
      staleUntil,
      nextSyncAt,
      warnings,
    }
  } catch {
    return null
  }
}

function mergeXPost(existing: XPost, incoming: XPost): XPost {
  return {
    ...incoming,
    language: incoming.language ?? existing.language,
    conversationId: incoming.conversationId ?? existing.conversationId,
    author: {
      ...incoming.author,
      id: incoming.author.id ?? existing.author.id,
      profileImageUrl:
        incoming.author.profileImageUrl ?? existing.author.profileImageUrl,
      verified: incoming.author.verified ?? existing.author.verified,
      protected: incoming.author.protected ?? existing.author.protected,
    },
    metrics: isEmptyMetrics(incoming.metrics)
      ? existing.metrics
      : incoming.metrics,
    media: incoming.media.length > 0 ? incoming.media : existing.media,
    references:
      incoming.references.length > 0
        ? incoming.references
        : existing.references,
  }
}

function isEmptyMetrics(metrics: XPost['metrics']): boolean {
  return (
    metrics.replies === 0 &&
    metrics.reposts === 0 &&
    metrics.likes === 0 &&
    metrics.quotes === 0 &&
    metrics.bookmarks === null &&
    metrics.impressions === null
  )
}

function parseSnapshotSource(value: unknown): XFeedSnapshotSource | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readRequiredString(value.id)
  const label = readRequiredString(value.label)
  const kind = value.kind
  const stability = value.stability
  const official = value.official
  const warning = value.warning

  if (
    !id ||
    !label ||
    !isSourceKind(kind) ||
    !isSourceStability(stability) ||
    !(
      typeof official === 'boolean' ||
      official === null
    ) ||
    !(typeof warning === 'string' || warning === null)
  ) {
    return null
  }

  return { id, kind, stability, label, official, warning }
}

function readWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((warning) => {
    const normalized = readRequiredString(warning)
    return normalized ? [normalized] : []
  })
}

function normalizePostCount(value: number | undefined): number {
  const resolved = value ?? DEFAULT_POST_COUNT

  if (
    !Number.isInteger(resolved) ||
    resolved < 1 ||
    resolved > MAX_POST_COUNT
  ) {
    throw new RangeError(
      `postCount must be an integer between 1 and ${MAX_POST_COUNT}.`,
    )
  }

  return resolved
}

function readDuration(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  const resolved = value ?? fallback

  if (
    !Number.isInteger(resolved) ||
    resolved < MIN_DURATION_MS ||
    resolved > MAX_DURATION_MS
  ) {
    throw new XFeedError(
      'INVALID_CONFIGURATION',
      `${field} must be an integer between ${MIN_DURATION_MS} and ${MAX_DURATION_MS}.`,
    )
  }

  return resolved
}

function createEmptyReadResult(
  state: 'empty' | 'invalid' | 'unavailable',
): XFeedReadResult {
  return {
    state,
    renderable: false,
    cachedPostCount: 0,
    posts: [],
    checksum: null,
    source: null,
    adapterVersion: null,
    generatedAt: null,
    freshUntil: null,
    staleUntil: null,
    nextSyncAt: null,
    warnings: [],
  }
}

function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function readDate(value: unknown): string | null {
  const raw = readRequiredString(value)
  if (!raw) {
    return null
  }

  const timestamp = Date.parse(raw)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

function isSourceKind(
  value: unknown,
): value is XFeedSourceMetadata['kind'] {
  return (
    value === 'official-api' ||
    value === 'rss-bridge' ||
    value === 'fallback' ||
    value === 'custom'
  )
}

function isSourceStability(
  value: unknown,
): value is XFeedSourceMetadata['stability'] {
  return (
    value === 'stable' ||
    value === 'experimental' ||
    value === 'composite' ||
    value === 'unknown'
  )
}

function assertValidDate(value: Date, field: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError(`${field} must be a valid Date.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
