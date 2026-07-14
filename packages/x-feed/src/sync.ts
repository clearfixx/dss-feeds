import {
  X_FEED_ADAPTER_VERSION,
  X_FEED_SNAPSHOT_VERSION,
  assertXFeedCacheKey,
  createXFeedCacheKey,
  createXFeedSnapshotSource,
  createXPostChecksum,
  findLatestXPostId,
  mergeXPosts,
  parseXFeedSnapshot,
  resolveXFeedCachePolicy,
  type XFeedCachePolicy,
  type XFeedSnapshot,
  type XFeedSnapshotStore,
} from './cache.js'
import { collectXPosts } from './feed.js'
import { resolveXFeedConfig } from './security.js'
import { readXFeedSourceRunDiagnostics } from './source-diagnostics.js'
import {
  XFeedError,
  type XFeedConfig,
  type XFeedSource,
  type XFeedSourceRunDiagnostics,
} from './types.js'

export type XFeedSyncLogLevel = 'info' | 'success' | 'warning' | 'error'

export interface XFeedSyncLogEntry {
  level: XFeedSyncLogLevel
  message: string
  timestamp: string
  context?: Readonly<Record<string, unknown>>
}

export interface XFeedSyncResult {
  status: 'success' | 'skipped'
  reason?: 'not_due'
  cacheKey: string
  created: boolean
  changed: boolean
  incremental: boolean
  sinceId: string | null
  fetchedPostCount: number
  cachedPostCount: number
  checksum: string | null
  generatedAt: string | null
  freshUntil: string | null
  staleUntil: string | null
  nextSyncAt: string | null
  warnings: readonly string[]
  sourceDiagnostics: XFeedSourceRunDiagnostics
}

export interface SynchronizeXFeedOptions {
  source: XFeedSource
  store: XFeedSnapshotStore
  config: XFeedConfig
  cacheKey?: string
  policy?: XFeedCachePolicy
  signal?: AbortSignal
  now?: Date
  force?: boolean
  /** Use the newest cached post ID as sinceId. Enabled by default. */
  incremental?: boolean
  onLog?: (entry: XFeedSyncLogEntry) => void | Promise<void>
}

export async function synchronizeXFeed(
  options: SynchronizeXFeedOptions,
): Promise<XFeedSyncResult> {
  const now = options.now ?? new Date()
  assertValidDate(now)
  const config = resolveXFeedConfig(options.config)
  const cacheKey = options.cacheKey
    ? assertXFeedCacheKey(options.cacheKey)
    : createXFeedCacheKey(config.username)
  const policy = resolveXFeedCachePolicy(options.policy)
  const incremental = options.incremental !== false

  await writeLog(options, now, 'info', 'Loading X feed snapshot.', {
    cacheKey,
  })

  const existing = await readSnapshot(options.store, cacheKey)

  if (
    options.force !== true &&
    existing &&
    Date.parse(existing.nextSyncAt) > now.getTime()
  ) {
    await writeLog(options, now, 'info', 'X feed synchronization is not due.', {
      nextSyncAt: existing.nextSyncAt,
    })

    return {
      status: 'skipped',
      reason: 'not_due',
      cacheKey,
      created: false,
      changed: false,
      incremental: false,
      sinceId: null,
      fetchedPostCount: 0,
      cachedPostCount: existing.posts.length,
      checksum: existing.checksum,
      generatedAt: existing.generatedAt,
      freshUntil: existing.freshUntil,
      staleUntil: existing.staleUntil,
      nextSyncAt: existing.nextSyncAt,
      warnings: existing.warnings,
      sourceDiagnostics: {
        requestedSourceId: options.source.id,
        selectedSourceId:
          existing.source.kind === 'fallback' ? null : existing.source.id,
        degraded: false,
        attempts: [],
      },
    }
  }

  const sinceId =
    incremental && existing ? findLatestXPostId(existing.posts) : null

  await writeLog(options, now, 'info', 'Requesting posts from X source.', {
    sourceId: options.source.id,
    username: config.username,
    postLimit: config.postLimit,
    incremental: sinceId !== null,
    sinceId,
  })

  let fetchedPosts
  try {
    fetchedPosts = await collectXPosts(
      options.source,
      config,
      {
        signal: options.signal,
        ...(sinceId ? { sinceId } : {}),
      },
    )
  } catch (error) {
    await writeLog(
      options,
      now,
      'error',
      'X feed synchronization failed before the snapshot was modified.',
      {
        sourceId: options.source.id,
        code: error instanceof XFeedError ? error.code : 'UNKNOWN_ERROR',
      },
    )
    throw error
  }

  const sourceDiagnostics = readXFeedSourceRunDiagnostics(options.source)
  const posts = mergeXPosts(
    existing?.posts ?? [],
    fetchedPosts,
    config.postLimit,
  )
  const checksum = createXPostChecksum(posts)
  const generatedAt = now.toISOString()
  const freshUntil = addMilliseconds(now, policy.freshForMs).toISOString()
  const staleUntil = addMilliseconds(
    new Date(freshUntil),
    policy.staleForMs,
  ).toISOString()
  const nextSyncAt = addMilliseconds(
    now,
    policy.syncIntervalMs,
  ).toISOString()
  const source = createXFeedSnapshotSource(options.source)
  const warnings = createWarnings(
    source.warning,
    posts.length,
    fetchedPosts.length,
    sourceDiagnostics,
  )
  const changed = existing?.checksum !== checksum

  const snapshot: XFeedSnapshot = {
    schemaVersion: X_FEED_SNAPSHOT_VERSION,
    key: cacheKey,
    username: config.username,
    posts,
    checksum,
    source,
    adapterVersion: X_FEED_ADAPTER_VERSION,
    generatedAt,
    freshUntil,
    staleUntil,
    nextSyncAt,
    warnings,
  }

  try {
    await options.store.write(snapshot)
  } catch (error) {
    await writeLog(options, now, 'error', 'X feed snapshot write failed.', {
      cacheKey,
    })
    throw new XFeedError(
      'CACHE_WRITE_FAILED',
      'X feed snapshot could not be persisted.',
      { cause: error, sourceId: options.source.id },
    )
  }

  if (fetchedPosts.length === 0 && existing) {
    await writeLog(
      options,
      now,
      'info',
      'X source returned no newer posts; the cached snapshot was retained.',
      { cachedPostCount: posts.length },
    )
  } else if (posts.length === 0) {
    await writeLog(options, now, 'warning', 'X source returned no posts.')
  }

  await writeLog(
    options,
    now,
    'success',
    existing
      ? 'X feed snapshot was synchronized successfully.'
      : 'X feed snapshot was created successfully.',
    {
      sourceId: options.source.id,
      selectedSourceId: sourceDiagnostics.selectedSourceId,
      degraded: sourceDiagnostics.degraded,
      fetchedPostCount: fetchedPosts.length,
      cachedPostCount: posts.length,
      changed,
      cacheKey,
    },
  )

  return {
    status: 'success',
    cacheKey,
    created: !existing,
    changed,
    incremental: sinceId !== null,
    sinceId,
    fetchedPostCount: fetchedPosts.length,
    cachedPostCount: posts.length,
    checksum,
    generatedAt,
    freshUntil,
    staleUntil,
    nextSyncAt,
    warnings,
    sourceDiagnostics,
  }
}

async function readSnapshot(
  store: XFeedSnapshotStore,
  key: string,
): Promise<XFeedSnapshot | null> {
  let value: unknown

  try {
    value = await store.read(key)
  } catch (error) {
    throw new XFeedError(
      'CACHE_READ_FAILED',
      'X feed snapshot could not be read.',
      { cause: error },
    )
  }

  if (value === null || value === undefined) {
    return null
  }

  const snapshot = parseXFeedSnapshot(value)
  if (!snapshot || snapshot.key !== key) {
    throw new XFeedError(
      'CACHE_READ_FAILED',
      'Stored X feed snapshot is invalid.',
    )
  }

  return snapshot
}

function createWarnings(
  sourceWarning: string | null,
  cachedPostCount: number,
  fetchedPostCount: number,
  diagnostics: XFeedSourceRunDiagnostics,
): string[] {
  const warnings: string[] = []

  if (sourceWarning) {
    warnings.push(sourceWarning)
  }

  if (diagnostics.degraded) {
    warnings.push(
      'The X feed synchronized through a fallback after one or more source failures.',
    )
  }

  if (cachedPostCount === 0 && fetchedPostCount === 0) {
    warnings.push('The configured X source returned no posts.')
  }

  return warnings
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds)
}

function assertValidDate(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError('now must be a valid Date.')
  }
}

async function writeLog(
  options: SynchronizeXFeedOptions,
  timestamp: Date,
  level: XFeedSyncLogLevel,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (!options.onLog) {
    return
  }

  await options.onLog({
    level,
    message,
    timestamp: timestamp.toISOString(),
    ...(context ? { context } : {}),
  })
}
