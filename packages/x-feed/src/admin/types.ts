import type { XFeedCacheState } from '../cache.js'
import type {
  XFeedMonitorLogEntry,
  XFeedMonitorStatus,
  XFeedMonitorTrigger,
} from '../monitor.js'
import type {
  XFeedSourceMetadata,
  XFeedSourceRunDiagnostics,
} from '../types.js'
import type { PayloadXFeedSourceMode } from '../payload/runtime.js'

export interface XFeedAdminCacheStatus {
  state: XFeedCacheState
  renderable: boolean
  cachedPostCount: number
  checksum: string | null
  sourceId: string | null
  source: XFeedSourceMetadata | null
  adapterVersion: string | null
  generatedAt: string | null
  freshUntil: string | null
  staleUntil: string | null
  nextSyncAt: string | null
  warnings: readonly string[]
}

export interface XFeedAdminMonitorStatus {
  status: XFeedMonitorStatus
  runId: string | null
  trigger: XFeedMonitorTrigger | null
  attemptCount: number
  consecutiveFailures: number
  consecutiveDegradedRuns: number
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastRecoveryAt: string | null
  completedAt: string | null
  durationMs: number | null
  lastError: string | null
  requestedSourceId: string | null
  selectedSourceId: string | null
  notificationSuppressedUntil: string | null
  lastNotificationAt: string | null
  history: readonly XFeedMonitorLogEntry[]
}

export interface XFeedAdminStatus {
  checkedAt: string
  settings: {
    enabled: boolean
    username: string | null
    sourceMode: PayloadXFeedSourceMode
    configuredSource: XFeedSourceMetadata
  }
  cache: XFeedAdminCacheStatus
  monitor: XFeedAdminMonitorStatus
  diagnostics: XFeedSourceRunDiagnostics | null
}
