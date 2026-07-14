import { createXFeedCacheKey } from './cache.js'
import {
  runMonitoredXFeedSync,
  type RunMonitoredXFeedSyncOptions,
  type XFeedHealthEvent,
  type XFeedMonitorState,
  type XFeedMonitorTrigger,
} from './monitor.js'
import {
  assertXFeedRunLockKey,
  type XFeedRunLock,
} from './run-lock.js'
import type {
  XFeedSyncLogEntry,
  XFeedSyncResult,
} from './sync.js'

export type XFeedExecutionReason = 'not_due' | 'locked'

export interface XFeedSyncExecutionReport {
  status: 'success' | 'skipped'
  reason?: XFeedExecutionReason
  trigger: XFeedMonitorTrigger
  cacheKey: string
  lockKey: string
  created: boolean
  changed: boolean
  fetchedPostCount: number
  cachedPostCount: number
  checksum: string | null
  generatedAt: string | null
  freshUntil: string | null
  staleUntil: string | null
  nextSyncAt: string | null
  selectedSourceId: string | null
  monitor: XFeedMonitorState | null
  healthEvents: readonly XFeedHealthEvent[]
  logs: readonly XFeedSyncLogEntry[]
}

export interface ExecuteXFeedSyncOptions
  extends Omit<RunMonitoredXFeedSyncOptions, 'onLog'> {
  lock?: XFeedRunLock
  lockKey?: string
  onLog?: (entry: XFeedSyncLogEntry) => void | Promise<void>
}

export async function executeXFeedSync(
  options: ExecuteXFeedSyncOptions,
): Promise<XFeedSyncExecutionReport> {
  const cacheKey =
    options.cacheKey ?? createXFeedCacheKey(options.config.username)
  const lockKey = assertXFeedRunLockKey(
    options.lockKey ?? `dss-x-feed:${cacheKey}`,
  )
  const lease = options.lock ? await options.lock.acquire(lockKey) : null

  if (options.lock && !lease) {
    return createLockedReport(options.trigger, cacheKey, lockKey)
  }

  const logs: XFeedSyncLogEntry[] = []

  try {
    const result = await runMonitoredXFeedSync({
      source: options.source,
      snapshotStore: options.snapshotStore,
      monitorStore: options.monitorStore,
      trigger: options.trigger,
      config: options.config,
      cacheKey,
      ...(options.policy ? { policy: options.policy } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.force !== undefined ? { force: options.force } : {}),
      ...(options.incremental !== undefined
        ? { incremental: options.incremental }
        : {}),
      ...(options.monitorPolicy
        ? { monitorPolicy: options.monitorPolicy }
        : {}),
      ...(options.onHealthEvent
        ? { onHealthEvent: options.onHealthEvent }
        : {}),
      async onLog(entry) {
        logs.push(entry)
        await options.onLog?.(entry)
      },
    })

    return createCompletedReport(
      result.sync,
      result.monitor,
      result.healthEvents,
      logs,
      options.trigger,
      lockKey,
    )
  } finally {
    await lease?.release()
  }
}

function createLockedReport(
  trigger: XFeedMonitorTrigger,
  cacheKey: string,
  lockKey: string,
): XFeedSyncExecutionReport {
  return {
    status: 'skipped',
    reason: 'locked',
    trigger,
    cacheKey,
    lockKey,
    created: false,
    changed: false,
    fetchedPostCount: 0,
    cachedPostCount: 0,
    checksum: null,
    generatedAt: null,
    freshUntil: null,
    staleUntil: null,
    nextSyncAt: null,
    selectedSourceId: null,
    monitor: null,
    healthEvents: [],
    logs: [],
  }
}

function createCompletedReport(
  sync: XFeedSyncResult,
  monitor: XFeedMonitorState,
  healthEvents: readonly XFeedHealthEvent[],
  logs: readonly XFeedSyncLogEntry[],
  trigger: XFeedMonitorTrigger,
  lockKey: string,
): XFeedSyncExecutionReport {
  return {
    status: sync.status,
    ...(sync.reason ? { reason: sync.reason } : {}),
    trigger,
    cacheKey: sync.cacheKey,
    lockKey,
    created: sync.created,
    changed: sync.changed,
    fetchedPostCount: sync.fetchedPostCount,
    cachedPostCount: sync.cachedPostCount,
    checksum: sync.checksum,
    generatedAt: sync.generatedAt,
    freshUntil: sync.freshUntil,
    staleUntil: sync.staleUntil,
    nextSyncAt: sync.nextSyncAt,
    selectedSourceId: sync.sourceDiagnostics.selectedSourceId,
    monitor,
    healthEvents: healthEvents.map((event) => ({
      ...event,
      state: structuredClone(event.state),
    })),
    logs: logs.map((entry) => ({
      ...entry,
      ...(entry.context
        ? { context: structuredClone(entry.context) }
        : {}),
    })),
  }
}
