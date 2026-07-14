import type { XFeedMonitorLogEntry } from '../monitor.js'
import type { PayloadXFeedSourceMode } from '../payload/runtime.js'
import type {
  XFeedSourceAttemptDiagnostic,
  XFeedSourceMetadata,
  XFeedSourceRunDiagnostics,
} from '../types.js'
import type { XFeedAdminStatus } from './types.js'

const EXPERIMENTAL_WARNING =
  'Unofficial X data bridge. It may stop working without notice when X, the bridge, or its authentication flow changes.'

export function getPayloadXFeedSourceModeMetadata(
  sourceMode: PayloadXFeedSourceMode,
): XFeedSourceMetadata {
  switch (sourceMode) {
    case 'official-api':
      return {
        kind: 'official-api',
        stability: 'stable',
        label: 'Official X API',
        official: true,
        warning: null,
      }
    case 'nitter':
      return {
        kind: 'rss-bridge',
        stability: 'experimental',
        label: 'Nitter-compatible RSS',
        official: false,
        warning: EXPERIMENTAL_WARNING,
      }
    case 'rsshub':
      return {
        kind: 'rss-bridge',
        stability: 'experimental',
        label: 'RSSHub',
        official: false,
        warning: EXPERIMENTAL_WARNING,
      }
    case 'fallback':
      return {
        kind: 'fallback',
        stability: 'composite',
        label: 'Fallback chain',
        official: null,
        warning:
          'This chain may include experimental RSS bridges. A failed bridge can silently move synchronization to another configured source, including the pay-per-use official API.',
      }
    case 'custom':
      return {
        kind: 'custom',
        stability: 'unknown',
        label: 'Custom source',
        official: null,
        warning:
          'The application owns the reliability and security guarantees of this custom source.',
      }
  }
}

export function parseXFeedAdminStatus(value: unknown): XFeedAdminStatus | null {
  if (!isRecord(value)) return null

  const checkedAt = readDate(value.checkedAt)
  const settings = parseSettings(value.settings)
  const cache = parseCache(value.cache)
  const monitor = parseMonitor(value.monitor)
  const diagnostics = parseDiagnostics(value.diagnostics)

  if (!checkedAt || !settings || !cache || !monitor) return null

  return {
    checkedAt,
    settings,
    cache,
    monitor,
    diagnostics,
  }
}

function parseSettings(value: unknown): XFeedAdminStatus['settings'] | null {
  if (!isRecord(value)) return null
  const sourceMode = readSourceMode(value.sourceMode)
  const configuredSource = parseSourceMetadata(value.configuredSource)
  if (!sourceMode || !configuredSource) return null
  return {
    enabled: value.enabled === true,
    username: readOptionalString(value.username),
    sourceMode,
    configuredSource,
  }
}

function parseCache(value: unknown): XFeedAdminStatus['cache'] | null {
  if (!isRecord(value)) return null
  const state = readCacheState(value.state)
  if (!state || !Array.isArray(value.warnings)) return null
  return {
    state,
    renderable: value.renderable === true,
    cachedPostCount: readNonNegativeInteger(value.cachedPostCount),
    checksum: readOptionalString(value.checksum),
    sourceId: readOptionalString(value.sourceId),
    source: parseSourceMetadata(value.source),
    adapterVersion: readOptionalString(value.adapterVersion),
    generatedAt: readDate(value.generatedAt),
    freshUntil: readDate(value.freshUntil),
    staleUntil: readDate(value.staleUntil),
    nextSyncAt: readDate(value.nextSyncAt),
    warnings: value.warnings.flatMap((warning) => {
      const message = readOptionalString(warning)
      return message ? [message] : []
    }),
  }
}

function parseMonitor(value: unknown): XFeedAdminStatus['monitor'] | null {
  if (!isRecord(value)) return null
  const status = readMonitorStatus(value.status)
  if (!status) return null
  return {
    status,
    runId: readOptionalString(value.runId),
    trigger: readTrigger(value.trigger),
    attemptCount: readNonNegativeInteger(value.attemptCount),
    consecutiveFailures: readNonNegativeInteger(value.consecutiveFailures),
    consecutiveDegradedRuns: readNonNegativeInteger(
      value.consecutiveDegradedRuns,
    ),
    lastAttemptAt: readDate(value.lastAttemptAt),
    lastSuccessAt: readDate(value.lastSuccessAt),
    lastFailureAt: readDate(value.lastFailureAt),
    lastRecoveryAt: readDate(value.lastRecoveryAt),
    completedAt: readDate(value.completedAt),
    durationMs: readNullableNonNegativeNumber(value.durationMs),
    lastError: readOptionalString(value.lastError),
    requestedSourceId: readOptionalString(value.requestedSourceId),
    selectedSourceId: readOptionalString(value.selectedSourceId),
    notificationSuppressedUntil: readDate(
      value.notificationSuppressedUntil,
    ),
    lastNotificationAt: readDate(value.lastNotificationAt),
    history: readHistory(value.history),
  }
}

function parseDiagnostics(
  value: unknown,
): XFeedSourceRunDiagnostics | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || !Array.isArray(value.attempts)) return null
  const requestedSourceId = readOptionalString(value.requestedSourceId)
  if (!requestedSourceId) return null
  return {
    requestedSourceId,
    selectedSourceId: readOptionalString(value.selectedSourceId),
    degraded: value.degraded === true,
    attempts: value.attempts.flatMap((attempt, index) => {
      const parsed = parseAttempt(attempt, index)
      return parsed ? [parsed] : []
    }),
  }
}

function parseAttempt(
  value: unknown,
  fallbackIndex: number,
): XFeedSourceAttemptDiagnostic | null {
  if (!isRecord(value)) return null
  const sourceId = readOptionalString(value.sourceId)
  const outcome = value.outcome
  if (
    !sourceId ||
    (outcome !== 'success' && outcome !== 'empty' && outcome !== 'error')
  ) {
    return null
  }
  return {
    sourceId,
    index: Number.isInteger(value.index)
      ? (value.index as number)
      : fallbackIndex,
    outcome,
    errorCode: readOptionalString(
      value.errorCode,
    ) as XFeedSourceAttemptDiagnostic['errorCode'],
    status: readNullableNonNegativeNumber(value.status),
  }
}

function parseSourceMetadata(value: unknown): XFeedSourceMetadata | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return null
  const kind = value.kind
  const stability = value.stability
  const label = readOptionalString(value.label)
  const official = value.official
  const warning = value.warning
  if (
    !label ||
    !isSourceKind(kind) ||
    !isSourceStability(stability) ||
    !(typeof official === 'boolean' || official === null) ||
    !(typeof warning === 'string' || warning === null)
  ) {
    return null
  }
  return { kind, stability, label, official, warning }
}

function readHistory(value: unknown): XFeedMonitorLogEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const level = entry.level
    const message = readOptionalString(entry.message)
    const timestamp = readDate(entry.timestamp)
    if (
      !message ||
      !timestamp ||
      (level !== 'info' &&
        level !== 'success' &&
        level !== 'warning' &&
        level !== 'error')
    ) {
      return []
    }
    return [
      {
        level,
        message,
        timestamp,
        ...(isRecord(entry.context) ? { context: entry.context } : {}),
      },
    ]
  })
}

function readSourceMode(value: unknown): PayloadXFeedSourceMode | null {
  return value === 'official-api' ||
    value === 'nitter' ||
    value === 'rsshub' ||
    value === 'fallback' ||
    value === 'custom'
    ? value
    : null
}

function readCacheState(value: unknown): XFeedAdminStatus['cache']['state'] | null {
  return value === 'empty' ||
    value === 'fresh' ||
    value === 'stale' ||
    value === 'expired' ||
    value === 'invalid' ||
    value === 'unavailable'
    ? value
    : null
}

function readMonitorStatus(
  value: unknown,
): XFeedAdminStatus['monitor']['status'] | null {
  return value === 'idle' ||
    value === 'running' ||
    value === 'healthy' ||
    value === 'degraded' ||
    value === 'failed'
    ? value
    : null
}

function readTrigger(
  value: unknown,
): XFeedAdminStatus['monitor']['trigger'] {
  return value === 'schedule' || value === 'manual' || value === 'endpoint'
    ? value
    : null
}

function isSourceKind(value: unknown): value is XFeedSourceMetadata['kind'] {
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

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function readDate(value: unknown): string | null {
  const raw = readOptionalString(value)
  if (!raw) return null
  const timestamp = Date.parse(raw)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

function readNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0
}

function readNullableNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
