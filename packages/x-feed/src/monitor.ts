import {
  createXFeedCacheKey,
  readXFeedSnapshot,
  type XFeedCacheState,
  type XFeedSnapshotStore,
} from './cache.js'
import { readXFeedSourceRunDiagnostics } from './source-diagnostics.js'
import { synchronizeXFeed, type SynchronizeXFeedOptions, type XFeedSyncResult } from './sync.js'
import { XFeedError, type XFeedSourceRunDiagnostics } from './types.js'

export const X_FEED_MONITOR_VERSION = 1 as const

export type XFeedMonitorStatus = 'idle' | 'running' | 'healthy' | 'degraded' | 'failed'
export type XFeedMonitorTrigger = 'schedule' | 'manual' | 'endpoint'
export type XFeedHealthEventType =
  | 'failure-threshold-reached'
  | 'source-degraded-threshold-reached'
  | 'recovered'

export interface XFeedMonitorLogEntry {
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  timestamp: string
  context?: Readonly<Record<string, unknown>>
}

export interface XFeedMonitorState {
  schemaVersion: typeof X_FEED_MONITOR_VERSION
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
  sourceDiagnostics: XFeedSourceRunDiagnostics | null
  cacheState: XFeedCacheState
  notificationSuppressedUntil: string | null
  lastNotificationAt: string | null
  history: readonly XFeedMonitorLogEntry[]
}

export interface XFeedMonitorStore {
  read(): Promise<unknown | null>
  write(state: XFeedMonitorState): Promise<void>
}

export interface XFeedMonitorPolicy {
  failureThreshold?: number
  notificationCooldownMs?: number
  maxHistoryEntries?: number
}

export interface XFeedHealthEvent {
  type: XFeedHealthEventType
  occurredAt: string
  state: XFeedMonitorState
}

export interface RunMonitoredXFeedSyncOptions
  extends Omit<SynchronizeXFeedOptions, 'store' | 'now'> {
  snapshotStore: XFeedSnapshotStore
  monitorStore: XFeedMonitorStore
  trigger: XFeedMonitorTrigger
  monitorPolicy?: XFeedMonitorPolicy
  now?: Date
  onHealthEvent?: (event: XFeedHealthEvent) => void | Promise<void>
}

export interface RunMonitoredXFeedSyncResult {
  sync: XFeedSyncResult
  monitor: XFeedMonitorState
  healthEvents: readonly XFeedHealthEvent[]
}

interface ResolvedMonitorPolicy {
  failureThreshold: number
  notificationCooldownMs: number
  maxHistoryEntries: number
}

export async function runMonitoredXFeedSync(
  options: RunMonitoredXFeedSyncOptions,
): Promise<RunMonitoredXFeedSyncResult> {
  const now = options.now ?? new Date()
  assertValidDate(now)
  const policy = resolveMonitorPolicy(options.monitorPolicy)
  const previous = await readMonitorState(options.monitorStore)
  const startedAt = now.toISOString()
  const running = appendHistory(
    {
      ...previous,
      status: 'running',
      runId: globalThis.crypto.randomUUID(),
      trigger: options.trigger,
      attemptCount: previous.attemptCount + 1,
      lastAttemptAt: startedAt,
      completedAt: null,
      durationMs: null,
      lastError: null,
    },
    {
      level: 'info',
      message: `Synchronization trigger: ${options.trigger}.`,
      timestamp: startedAt,
    },
    policy.maxHistoryEntries,
  )
  await writeMonitorState(options.monitorStore, running)

  let sync: XFeedSyncResult
  try {
    sync = await synchronizeXFeed({
      source: options.source,
      store: options.snapshotStore,
      config: options.config,
      ...(options.cacheKey ? { cacheKey: options.cacheKey } : {}),
      ...(options.policy ? { policy: options.policy } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.force !== undefined ? { force: options.force } : {}),
      ...(options.incremental !== undefined
        ? { incremental: options.incremental }
        : {}),
      ...(options.onLog ? { onLog: options.onLog } : {}),
      now,
    })
  } catch (error) {
    const completedAt = options.now ? new Date(now) : new Date()
    const cache = await readXFeedSnapshot({
      store: options.snapshotStore,
      key:
        options.cacheKey ??
        createXFeedCacheKey(options.config.username),
      now: completedAt,
    })
    const failed = completeFailedRun(
      running,
      error,
      readXFeedSourceRunDiagnostics(options.source, error),
      cache.state,
      startedAt,
      completedAt,
      policy,
    )
    await writeMonitorState(options.monitorStore, failed.state)
    await emitHealthEvents(options.onHealthEvent, failed.events)
    throw error
  }

  const completedAt = options.now ? new Date(now) : new Date()
  const completed = completeSuccessfulRun(
    running,
    sync,
    startedAt,
    completedAt,
    policy,
  )
  await writeMonitorState(options.monitorStore, completed.state)
  await emitHealthEvents(options.onHealthEvent, completed.events)
  return { sync, monitor: completed.state, healthEvents: completed.events }

}

export function createInitialXFeedMonitorState(): XFeedMonitorState {
  return {
    schemaVersion: X_FEED_MONITOR_VERSION,
    status: 'idle',
    runId: null,
    trigger: null,
    attemptCount: 0,
    consecutiveFailures: 0,
    consecutiveDegradedRuns: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastRecoveryAt: null,
    completedAt: null,
    durationMs: null,
    lastError: null,
    requestedSourceId: null,
    selectedSourceId: null,
    sourceDiagnostics: null,
    cacheState: 'empty',
    notificationSuppressedUntil: null,
    lastNotificationAt: null,
    history: [],
  }
}

export function parseXFeedMonitorState(value: unknown): XFeedMonitorState | null {
  if (!isRecord(value) || value.schemaVersion !== X_FEED_MONITOR_VERSION) return null
  const initial = createInitialXFeedMonitorState()
  const status = readStatus(value.status)
  if (!status) return null
  return {
    ...initial,
    status,
    runId: readString(value.runId),
    trigger: readTrigger(value.trigger),
    attemptCount: readInteger(value.attemptCount),
    consecutiveFailures: readInteger(value.consecutiveFailures),
    consecutiveDegradedRuns: readInteger(value.consecutiveDegradedRuns),
    lastAttemptAt: readDate(value.lastAttemptAt),
    lastSuccessAt: readDate(value.lastSuccessAt),
    lastFailureAt: readDate(value.lastFailureAt),
    lastRecoveryAt: readDate(value.lastRecoveryAt),
    completedAt: readDate(value.completedAt),
    durationMs: readNumber(value.durationMs),
    lastError: readString(value.lastError),
    requestedSourceId: readString(value.requestedSourceId),
    selectedSourceId: readString(value.selectedSourceId),
    sourceDiagnostics: parseDiagnostics(value.sourceDiagnostics),
    cacheState: readCacheState(value.cacheState),
    notificationSuppressedUntil: readDate(value.notificationSuppressedUntil),
    lastNotificationAt: readDate(value.lastNotificationAt),
    history: readHistory(value.history),
  }
}

function completeSuccessfulRun(
  previous: XFeedMonitorState,
  sync: XFeedSyncResult,
  startedAt: string,
  completedAt: Date,
  policy: ResolvedMonitorPolicy,
): { state: XFeedMonitorState; events: XFeedHealthEvent[] } {
  const timestamp = completedAt.toISOString()
  const degraded = sync.sourceDiagnostics.degraded
  const consecutiveDegradedRuns = degraded
    ? previous.consecutiveDegradedRuns + 1
    : 0
  const recovered =
    !degraded &&
    (previous.consecutiveFailures > 0 ||
      previous.consecutiveDegradedRuns > 0 ||
      previous.status === 'degraded' ||
      previous.status === 'failed')
  const cooldownExpired =
    !previous.notificationSuppressedUntil ||
    Date.parse(previous.notificationSuppressedUntil) <= completedAt.getTime()
  const shouldNotifyDegraded =
    degraded &&
    consecutiveDegradedRuns >= policy.failureThreshold &&
    cooldownExpired
  const suppressedUntil = shouldNotifyDegraded
    ? new Date(
        completedAt.getTime() + policy.notificationCooldownMs,
      ).toISOString()
    : degraded
      ? previous.notificationSuppressedUntil
      : null
  let state = appendHistory(
    {
      ...previous,
      status: degraded ? 'degraded' : 'healthy',
      consecutiveFailures: 0,
      consecutiveDegradedRuns,
      lastSuccessAt: timestamp,
      lastRecoveryAt: recovered ? timestamp : previous.lastRecoveryAt,
      completedAt: timestamp,
      durationMs: calculateDuration(startedAt, timestamp),
      lastError: null,
      requestedSourceId: sync.sourceDiagnostics.requestedSourceId,
      selectedSourceId: sync.sourceDiagnostics.selectedSourceId,
      sourceDiagnostics: sync.sourceDiagnostics,
      cacheState: 'fresh',
      notificationSuppressedUntil: suppressedUntil,
      lastNotificationAt: shouldNotifyDegraded
        ? timestamp
        : previous.lastNotificationAt,
    },
    {
      level: degraded ? 'warning' : 'success',
      message: degraded
        ? 'X feed synchronized through a fallback source.'
        : 'X feed synchronized successfully.',
      timestamp,
    },
    policy.maxHistoryEntries,
  )
  const events: XFeedHealthEvent[] = []
  if (shouldNotifyDegraded) {
    events.push({
      type: 'source-degraded-threshold-reached',
      occurredAt: timestamp,
      state,
    })
    state = appendHistory(
      state,
      {
        level: 'warning',
        message: `Fallback degradation threshold reached after ${consecutiveDegradedRuns} consecutive runs.`,
        timestamp,
      },
      policy.maxHistoryEntries,
    )
  }
  if (recovered) {
    const event = { type: 'recovered', occurredAt: timestamp, state } as const
    events.push(event)
    state = appendHistory(
      state,
      { level: 'success', message: 'X feed source recovered.', timestamp },
      policy.maxHistoryEntries,
    )
  }
  return { state, events: events.map((event) => ({ ...event, state })) }
}

function completeFailedRun(
  previous: XFeedMonitorState,
  error: unknown,
  diagnostics: XFeedSourceRunDiagnostics,
  cacheState: XFeedCacheState,
  startedAt: string,
  completedAt: Date,
  policy: ResolvedMonitorPolicy,
): { state: XFeedMonitorState; events: XFeedHealthEvent[] } {
  const timestamp = completedAt.toISOString()
  const consecutiveFailures = previous.consecutiveFailures + 1
  const renderable = cacheState === 'fresh' || cacheState === 'stale'
  const cooldownExpired =
    !previous.notificationSuppressedUntil ||
    Date.parse(previous.notificationSuppressedUntil) <= completedAt.getTime()
  const shouldNotify =
    consecutiveFailures >= policy.failureThreshold && cooldownExpired
  const suppressedUntil = shouldNotify
    ? new Date(completedAt.getTime() + policy.notificationCooldownMs).toISOString()
    : previous.notificationSuppressedUntil
  const message = readErrorMessage(error)
  let state = appendHistory(
    {
      ...previous,
      status: renderable ? 'degraded' : 'failed',
      consecutiveFailures,
      lastFailureAt: timestamp,
      completedAt: timestamp,
      durationMs: calculateDuration(startedAt, timestamp),
      lastError: message,
      requestedSourceId: diagnostics.requestedSourceId,
      selectedSourceId: diagnostics.selectedSourceId,
      sourceDiagnostics: diagnostics,
      cacheState,
      notificationSuppressedUntil: suppressedUntil,
      lastNotificationAt: shouldNotify ? timestamp : previous.lastNotificationAt,
    },
    { level: 'error', message, timestamp, context: { cacheState } },
    policy.maxHistoryEntries,
  )
  const events: XFeedHealthEvent[] = []
  if (shouldNotify) {
    const event = {
      type: 'failure-threshold-reached',
      occurredAt: timestamp,
      state,
    } as const
    events.push(event)
    state = appendHistory(
      state,
      {
        level: 'warning',
        message: `Failure notification threshold reached after ${consecutiveFailures} consecutive attempts.`,
        timestamp,
      },
      policy.maxHistoryEntries,
    )
  }
  return { state, events: events.map((event) => ({ ...event, state })) }
}

function resolveMonitorPolicy(policy: XFeedMonitorPolicy = {}): ResolvedMonitorPolicy {
  return {
    failureThreshold: readRange(policy.failureThreshold, 3, 1, 20, 'failureThreshold'),
    notificationCooldownMs: readRange(
      policy.notificationCooldownMs,
      12 * 60 * 60 * 1000,
      60 * 1000,
      30 * 24 * 60 * 60 * 1000,
      'notificationCooldownMs',
    ),
    maxHistoryEntries: readRange(policy.maxHistoryEntries, 30, 5, 100, 'maxHistoryEntries'),
  }
}

async function readMonitorState(store: XFeedMonitorStore): Promise<XFeedMonitorState> {
  try {
    const value = await store.read()
    return parseXFeedMonitorState(value) ?? createInitialXFeedMonitorState()
  } catch (error) {
    throw new XFeedError('MONITOR_READ_FAILED', 'X feed monitor state could not be read.', { cause: error })
  }
}

async function writeMonitorState(store: XFeedMonitorStore, state: XFeedMonitorState): Promise<void> {
  try {
    await store.write(state)
  } catch (error) {
    throw new XFeedError('MONITOR_WRITE_FAILED', 'X feed monitor state could not be persisted.', { cause: error })
  }
}

async function emitHealthEvents(
  handler: RunMonitoredXFeedSyncOptions['onHealthEvent'],
  events: readonly XFeedHealthEvent[],
): Promise<void> {
  if (!handler) return
  for (const event of events) {
    try { await handler(event) } catch { /* notification transports are best effort */ }
  }
}

function appendHistory(
  state: XFeedMonitorState,
  entry: XFeedMonitorLogEntry,
  limit: number,
): XFeedMonitorState {
  return { ...state, history: [...state.history, entry].slice(-limit) }
}

function parseDiagnostics(value: unknown): XFeedSourceRunDiagnostics | null {
  if (!isRecord(value) || !Array.isArray(value.attempts)) return null
  const requestedSourceId = readString(value.requestedSourceId)
  if (!requestedSourceId) return null
  return {
    requestedSourceId,
    selectedSourceId: readString(value.selectedSourceId),
    degraded: value.degraded === true,
    attempts: value.attempts.flatMap((attempt, index) => {
      if (!isRecord(attempt)) return []
      const sourceId = readString(attempt.sourceId)
      const outcome = attempt.outcome
      if (!sourceId || (outcome !== 'success' && outcome !== 'empty' && outcome !== 'error')) return []
      return [{
        sourceId,
        index: readInteger(attempt.index ?? index),
        outcome,
        errorCode: readString(attempt.errorCode) as never,
        status: readNumber(attempt.status),
      }]
    }),
  }
}

function readHistory(value: unknown): XFeedMonitorLogEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const level = entry.level
    const message = readString(entry.message)
    const timestamp = readDate(entry.timestamp)
    if (!message || !timestamp || !['info','success','warning','error'].includes(String(level))) return []
    return [{ level: level as XFeedMonitorLogEntry['level'], message, timestamp, ...(isRecord(entry.context) ? { context: entry.context } : {}) }]
  }).slice(-100)
}

function calculateDuration(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))
}
function readErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : 'X feed synchronization failed.'
}
function readRange(value: number | undefined, fallback: number, min: number, max: number, field: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) throw new RangeError(`${field} must be an integer between ${min} and ${max}.`)
  return resolved
}
function readStatus(value: unknown): XFeedMonitorStatus | null {
  return value === 'idle' || value === 'running' || value === 'healthy' || value === 'degraded' || value === 'failed' ? value : null
}
function readTrigger(value: unknown): XFeedMonitorTrigger | null {
  return value === 'schedule' || value === 'manual' || value === 'endpoint' ? value : null
}
function readCacheState(value: unknown): XFeedCacheState {
  return value === 'empty' || value === 'fresh' || value === 'stale' || value === 'expired' || value === 'invalid' || value === 'unavailable' ? value : 'empty'
}
function readString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function readDate(value: unknown): string | null { const valueString = readString(value); if (!valueString) return null; const time = Date.parse(valueString); return Number.isNaN(time) ? null : new Date(time).toISOString() }
function readInteger(value: unknown): number { return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0 }
function readNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null }
function assertValidDate(value: Date): void { if (Number.isNaN(value.getTime())) throw new TypeError('now must be a valid Date.') }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
