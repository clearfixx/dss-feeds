'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  parseXFeedAdminStatus,
} from './status.js'
import {
  XFeedMonitorActions,
  type XFeedMonitorActionState,
} from './MonitorActions.js'
import type { XFeedAdminStatus } from './types.js'

export interface XFeedMonitorClientProps {
  initialStatus: XFeedAdminStatus
  statusEndpointURL: string
  syncEndpointURL: string
  title: string
  pollIntervalMs?: number
}

const MAX_POLL_DURATION_MS = 60_000

const subscribeToHydration = () => () => undefined
const getHydratedClientSnapshot = () => true
const getHydratedServerSnapshot = () => false

export function XFeedMonitorClient({
  initialStatus,
  statusEndpointURL,
  syncEndpointURL,
  title,
  pollIntervalMs = 1500,
}: XFeedMonitorClientProps) {
  const [status, setStatus] = useState(initialStatus)
  const [actionState, setActionState] =
    useState<XFeedMonitorActionState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const baselineRunId = useRef(initialStatus.monitor.runId)
  const pollingStartedAt = useRef<number | null>(null)
  const refreshInFlight = useRef(false)
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedClientSnapshot,
    getHydratedServerSnapshot,
  )

  useEffect(() => {
    if (!polling) return
    let cancelled = false

    async function tick() {
      if (cancelled || refreshInFlight.current) return
      refreshInFlight.current = true
      try {
        const next = await fetchStatus(statusEndpointURL)
        const hasNewRun =
          Boolean(next.monitor.runId) &&
          next.monitor.runId !== baselineRunId.current
        setStatus(next)

        if (hasNewRun || next.monitor.status === 'running') {
          setActionState(toActionState(next.monitor.status))
          if (isTerminalStatus(next.monitor.status)) {
            setPolling(false)
            setMessage(
              next.monitor.status === 'failed'
                ? 'Synchronization failed. Review the diagnostics.'
                : next.monitor.status === 'degraded'
                  ? 'Synchronization completed through a degraded source.'
                  : 'Cache regenerated successfully.',
            )
          } else {
            setMessage('Synchronization is running…')
          }
        } else {
          const elapsed =
            Date.now() - (pollingStartedAt.current ?? Date.now())
          if (elapsed >= MAX_POLL_DURATION_MS) {
            setPolling(false)
            setActionState('error')
            setMessage(
              'Job is still queued. Make sure the X feed worker is running.',
            )
          }
        }
      } catch {
        setMessage('Unable to refresh synchronization status.')
      } finally {
        refreshInFlight.current = false
      }
    }

    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, Math.max(750, pollIntervalMs))

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [polling, pollIntervalMs, statusEndpointURL])

  async function refreshStatus() {
    if (refreshInFlight.current) return
    setActionState('refreshing')
    setMessage('Refreshing local status…')
    refreshInFlight.current = true
    try {
      const next = await fetchStatus(statusEndpointURL)
      setStatus(next)
      setActionState('idle')
      setMessage('Status refreshed.')
    } catch {
      setActionState('error')
      setMessage('Unable to refresh status.')
    } finally {
      refreshInFlight.current = false
    }
  }

  async function regenerateCache() {
    setActionState('queueing')
    setMessage('Queueing cache regeneration…')
    try {
      const response = await fetch(syncEndpointURL, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Queue request failed with HTTP ${response.status}.`)
      }
      baselineRunId.current = status.monitor.runId
      pollingStartedAt.current = Date.now()
      setActionState('queued')
      setMessage('Synchronization queued. Waiting for the worker…')
      setPolling(true)
    } catch {
      setActionState('error')
      setMessage('Unable to queue synchronization.')
    }
  }

  const configuredSource = status.settings.configuredSource
  const danger = configuredSource.stability === 'experimental'
  const composite = configuredSource.stability === 'composite'
  const attempts = status.diagnostics?.attempts ?? []

  return (
    <section className="dss-x-admin" aria-labelledby="dss-x-admin-title">
      <header className="dss-x-admin__header">
        <div>
          <span className="dss-x-admin__eyebrow">DSS Feeds</span>
          <h2 id="dss-x-admin-title">{title}</h2>
          <p>
            Status is read from Payload cache and persistent monitor state.
            The browser never contacts X or an RSS bridge directly.
          </p>
        </div>
        <StatusBadge status={status.monitor.status} />
      </header>

      <div className="dss-x-admin__source-row">
        <div>
          <span className="dss-x-admin__label">Configured source</span>
          <strong>{configuredSource.label}</strong>
        </div>
        {danger ? (
          <span className="dss-x-admin__risk" data-tone="danger">
            Experimental · may break
          </span>
        ) : composite ? (
          <span className="dss-x-admin__risk" data-tone="warning">
            Contains fallback sources
          </span>
        ) : (
          <span className="dss-x-admin__risk" data-tone="safe">
            Stable source
          </span>
        )}
      </div>

      {configuredSource.warning ? (
        <div
          className="dss-x-admin__warning"
          data-tone={danger ? 'danger' : 'warning'}
          role="note"
        >
          <strong>{danger ? 'Unsafe experimental source' : 'Source warning'}</strong>
          <p>{configuredSource.warning}</p>
          {danger ? (
            <p>
              Persistent failures create a health event after the configured
              threshold so the host application can notify an administrator.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="dss-x-admin__metrics">
        <Metric label="Cache state" value={status.cache.state} />
        <Metric label="Cached posts" value={status.cache.cachedPostCount} />
        <Metric
          label="Selected source"
          value={status.monitor.selectedSourceId ?? '—'}
        />
        <Metric
          label="Last success"
          value={<LocalDate hydrated={isHydrated} value={status.monitor.lastSuccessAt} />}
        />
        <Metric
          label="Consecutive failures"
          value={status.monitor.consecutiveFailures}
        />
        <Metric
          label="Degraded runs"
          value={status.monitor.consecutiveDegradedRuns}
        />
        <Metric
          label="Next sync"
          value={<LocalDate hydrated={isHydrated} value={status.cache.nextSyncAt} />}
        />
        <Metric
          label="Last duration"
          value={formatDuration(status.monitor.durationMs)}
        />
      </div>

      {status.cache.state === 'stale' ? (
        <div className="dss-x-admin__warning" data-tone="warning">
          <strong>Stale cache is active</strong>
          <p>
            Visitors can still receive the last successful snapshot while the
            source is unavailable.
          </p>
        </div>
      ) : null}

      {status.monitor.lastError ? (
        <div className="dss-x-admin__warning" data-tone="danger">
          <strong>Last synchronization error</strong>
          <p>{status.monitor.lastError}</p>
        </div>
      ) : null}

      <XFeedMonitorActions
        state={actionState}
        message={message}
        onRefresh={() => {
          void refreshStatus()
        }}
        onRegenerate={() => {
          void regenerateCache()
        }}
      />

      <section className="dss-x-admin__section">
        <div className="dss-x-admin__section-heading">
          <h3>Source attempts</h3>
          <span>{attempts.length} attempts</span>
        </div>
        {attempts.length > 0 ? (
          <div className="dss-x-admin__attempts">
            {attempts.map((attempt) => (
              <div className="dss-x-admin__attempt" key={`${attempt.index}:${attempt.sourceId}`}>
                <strong>{attempt.sourceId}</strong>
                <span data-outcome={attempt.outcome}>{attempt.outcome}</span>
                <small>
                  {attempt.errorCode ?? 'no error'}
                  {attempt.status === null ? '' : ` · HTTP ${attempt.status}`}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="dss-x-admin__empty">No source diagnostics yet.</p>
        )}
      </section>

      <section className="dss-x-admin__section">
        <div className="dss-x-admin__section-heading">
          <h3>Synchronization log</h3>
          <span>{status.monitor.history.length} events</span>
        </div>
        <div className="dss-x-admin__console">
          {status.monitor.history.length > 0 ? (
            status.monitor.history.map((entry, index) => (
              <div className="dss-x-admin__console-line" key={`${entry.timestamp}:${index}`}>
                <time>{formatConsoleTime(entry.timestamp, isHydrated)}</time>
                <span data-level={entry.level}>{entry.level}</span>
                <p>{entry.message}</p>
                {entry.context ? <code>{safeStringify(entry.context)}</code> : null}
              </div>
            ))
          ) : (
            <p className="dss-x-admin__empty">No synchronization events yet.</p>
          )}
        </div>
      </section>

      <footer className="dss-x-admin__footer">
        Checked <LocalDate hydrated={isHydrated} value={status.checkedAt} />
        {status.monitor.notificationSuppressedUntil ? (
          <>
            {' · '}Notification cooldown until{' '}
            <LocalDate
              hydrated={isHydrated}
              value={status.monitor.notificationSuppressedUntil}
            />
          </>
        ) : null}
      </footer>
    </section>
  )
}

async function fetchStatus(endpointURL: string): Promise<XFeedAdminStatus> {
  const response = await fetch(endpointURL, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Status request failed with HTTP ${response.status}.`)
  }
  const parsed = parseXFeedAdminStatus(await response.json())
  if (!parsed) throw new TypeError('Invalid X feed status response.')
  return parsed
}

function toActionState(
  status: XFeedAdminStatus['monitor']['status'],
): XFeedMonitorActionState {
  if (status === 'running') return 'running'
  if (status === 'failed') return 'error'
  if (status === 'healthy' || status === 'degraded') return 'success'
  return 'idle'
}

function isTerminalStatus(
  status: XFeedAdminStatus['monitor']['status'],
): boolean {
  return status === 'healthy' || status === 'degraded' || status === 'failed'
}

function StatusBadge({
  status,
}: {
  status: XFeedAdminStatus['monitor']['status']
}) {
  return (
    <span className="dss-x-admin__status" data-status={status}>
      {status}
    </span>
  )
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="dss-x-admin__metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function LocalDate({
  hydrated,
  value,
}: {
  hydrated: boolean
  value: string | null
}) {
  return <time dateTime={value ?? undefined}>{formatDate(value, hydrated)}</time>
}

function formatDate(value: string | null, hydrated: boolean): string {
  if (!value) return '—'

  const timestamp = Date.parse(value)

  if (Number.isNaN(timestamp)) return '—'

  const date = new Date(timestamp)

  if (!hydrated) {
    const isoValue = date.toISOString()

    return `${isoValue.slice(0, 10)} ${isoValue.slice(11, 16)} UTC`
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatConsoleTime(value: string, hydrated: boolean): string {
  const timestamp = Date.parse(value)

  if (Number.isNaN(timestamp)) return '--:--:--'

  const date = new Date(timestamp)

  if (!hydrated) {
    return `${date.toISOString().slice(11, 19)} UTC`
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

function formatDuration(value: number | null): string {
  if (value === null) return '—'
  if (value < 1000) return `${value} ms`
  return `${(value / 1000).toFixed(1)} s`
}

function safeStringify(value: Readonly<Record<string, unknown>>): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}
