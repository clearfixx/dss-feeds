import type { Payload } from 'payload'
import {
  createXFeedCacheKey,
  readXFeedSnapshot,
} from '../cache.js'
import {
  createInitialXFeedMonitorState,
  parseXFeedMonitorState,
} from '../monitor.js'
import {
  getPayloadXFeedSourceModeMetadata,
} from '../admin/status.js'
import type { XFeedAdminStatus } from '../admin/types.js'
import { createPayloadXFeedSnapshotStore } from './cache.js'
import { createPayloadXFeedMonitorStore } from './monitor-store.js'
import type { PayloadXFeedSourceMode } from './runtime.js'

export interface LoadXFeedAdminStatusOptions {
  payload: Payload
  settingsSlug?: string
  cacheSlug?: string
  cacheKey?: string
  now?: Date
}

interface PayloadSettingsClient {
  findGlobal(args: {
    slug: string
    overrideAccess: true
  }): Promise<Record<string, unknown>>
}

const DEFAULT_SETTINGS_SLUG = 'dss-x-feed-settings'

export async function loadXFeedAdminStatus(
  options: LoadXFeedAdminStatusOptions,
): Promise<XFeedAdminStatus> {
  const now = options.now ?? new Date()
  if (Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date.')
  }

  const settingsSlug = options.settingsSlug ?? DEFAULT_SETTINGS_SLUG
  const client = options.payload as unknown as PayloadSettingsClient
  const rawSettings = await client.findGlobal({
    slug: settingsSlug,
    overrideAccess: true,
  })
  const enabled = rawSettings.enabled === true
  const username = readOptionalString(rawSettings.username)
  const sourceMode = readSourceMode(rawSettings.sourceMode)
  const key = options.cacheKey ?? resolveCacheKey(username)

  const [cache, rawMonitor] = await Promise.all([
    readXFeedSnapshot({
      store: createPayloadXFeedSnapshotStore({
        payload: options.payload,
        ...(options.cacheSlug
          ? { collectionSlug: options.cacheSlug }
          : {}),
      }),
      key,
      postCount: 100,
      now,
    }),
    createPayloadXFeedMonitorStore({
      payload: options.payload,
      settingsSlug,
    }).read(),
  ])

  const monitor =
    parseXFeedMonitorState(rawMonitor) ?? createInitialXFeedMonitorState()

  return {
    checkedAt: now.toISOString(),
    settings: {
      enabled,
      username,
      sourceMode,
      configuredSource: getPayloadXFeedSourceModeMetadata(sourceMode),
    },
    cache: {
      state: cache.state,
      renderable: cache.renderable,
      cachedPostCount: cache.cachedPostCount,
      checksum: cache.checksum,
      sourceId: cache.source?.id ?? null,
      source: cache.source
        ? {
            kind: cache.source.kind,
            stability: cache.source.stability,
            label: cache.source.label,
            official: cache.source.official,
            warning: cache.source.warning,
          }
        : null,
      adapterVersion: cache.adapterVersion,
      generatedAt: cache.generatedAt,
      freshUntil: cache.freshUntil,
      staleUntil: cache.staleUntil,
      nextSyncAt: cache.nextSyncAt,
      warnings: cache.warnings,
    },
    monitor: {
      status: monitor.status,
      runId: monitor.runId,
      trigger: monitor.trigger,
      attemptCount: monitor.attemptCount,
      consecutiveFailures: monitor.consecutiveFailures,
      consecutiveDegradedRuns: monitor.consecutiveDegradedRuns,
      lastAttemptAt: monitor.lastAttemptAt,
      lastSuccessAt: monitor.lastSuccessAt,
      lastFailureAt: monitor.lastFailureAt,
      lastRecoveryAt: monitor.lastRecoveryAt,
      completedAt: monitor.completedAt,
      durationMs: monitor.durationMs,
      lastError: monitor.lastError,
      requestedSourceId: monitor.requestedSourceId,
      selectedSourceId: monitor.selectedSourceId,
      notificationSuppressedUntil: monitor.notificationSuppressedUntil,
      lastNotificationAt: monitor.lastNotificationAt,
      history: monitor.history,
    },
    diagnostics: monitor.sourceDiagnostics,
  }
}

function resolveCacheKey(username: string | null): string {
  if (!username) return 'x:unconfigured'
  try {
    return createXFeedCacheKey(username)
  } catch {
    return 'x:unconfigured'
  }
}

function readSourceMode(value: unknown): PayloadXFeedSourceMode {
  return value === 'official-api' ||
    value === 'nitter' ||
    value === 'rsshub' ||
    value === 'fallback' ||
    value === 'custom'
    ? value
    : 'official-api'
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}
