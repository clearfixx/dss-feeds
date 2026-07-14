'use client'

import {
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  ReactNode,
} from 'react'

import {
  RegenerateGitHubFeedButton,
  type GitHubFeedMonitorActionState,
} from './RegenerateButton.js'
import type {
  GitHubFeedAdminEvent,
  GitHubFeedAdminJob,
  GitHubFeedAdminJobStatus,
  GitHubFeedAdminStatus,
} from './types.js'

export interface GitHubFeedMonitorClientProps {
  initialStatus: GitHubFeedAdminStatus
  syncEndpointURL: string
  settingsEndpointURL: string
  title: string
  pollIntervalMs?: number
}

const MAX_POLL_DURATION_MS =
  60_000

export function GitHubFeedMonitorClient({
  initialStatus,
  syncEndpointURL,
  settingsEndpointURL,
  title,
  pollIntervalMs = 1500,
}: GitHubFeedMonitorClientProps) {
  const [status, setStatus] =
    useState(initialStatus)
  const [actionState, setActionState] =
    useState<
      GitHubFeedMonitorActionState
    >('idle')
  const [message, setMessage] =
    useState<string | null>(null)
  const [polling, setPolling] =
    useState(false)
  const baselineRunId =
    useRef<string | null>(
      initialStatus.jobs[0]?.id ??
      null,
    )
  const pollingStartedAt =
    useRef<number | null>(null)
  const refreshInFlight =
    useRef(false)

  useEffect(() => {
    if (!polling) {
      return
    }

    let cancelled = false

    async function tick() {
      if (
        cancelled ||
        refreshInFlight.current
      ) {
        return
      }

      refreshInFlight.current = true

      try {
        const next =
          await fetchRuntimeStatus(
            settingsEndpointURL,
            status,
          )
        const latest =
          next.jobs[0] ?? null
        const hasNewRun =
          Boolean(latest) &&
          latest?.id !==
            baselineRunId.current

        if (hasNewRun && latest) {
          setStatus(next)
          setActionState(
            toActionState(
              latest.status,
            ),
          )

          if (
            isTerminalStatus(
              latest.status,
            )
          ) {
            setPolling(false)
            setMessage(
              latest.status ===
                'error'
                ? 'Synchronization failed. Review the log.'
                : latest.status ===
                    'skipped'
                  ? 'Synchronization was skipped.'
                  : 'Cache regenerated successfully.',
            )
          } else {
            setMessage(
              'Synchronization is running…',
            )
          }
        } else {
          const elapsed =
            Date.now() -
            (pollingStartedAt.current ??
              Date.now())

          if (
            elapsed >=
            MAX_POLL_DURATION_MS
          ) {
            setPolling(false)
            setActionState('error')
            setMessage(
              'Job is still queued. Make sure the GitHub feed worker is running.',
            )
          }
        }
      } catch {
        setMessage(
          'Unable to refresh synchronization status.',
        )
      } finally {
        refreshInFlight.current = false
      }
    }

    void tick()

    const timer =
      window.setInterval(
        () => {
          void tick()
        },
        Math.max(
          750,
          pollIntervalMs,
        ),
      )

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [
    polling,
    pollIntervalMs,
    settingsEndpointURL,
    status,
  ])

  async function refreshStatus() {
    if (refreshInFlight.current) {
      return
    }

    setActionState('refreshing')
    setMessage(
      'Refreshing local status…',
    )
    refreshInFlight.current = true

    try {
      const next =
        await fetchRuntimeStatus(
          settingsEndpointURL,
          status,
        )

      setStatus(next)
      setActionState('idle')
      setMessage(
        'Status refreshed.',
      )
    } catch {
      setActionState('error')
      setMessage(
        'Unable to refresh status.',
      )
    } finally {
      refreshInFlight.current = false
    }
  }

  async function regenerateCache() {
    setActionState('queueing')
    setMessage(
      'Queueing cache regeneration…',
    )

    try {
      const response = await fetch(
        syncEndpointURL,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept:
              'application/json',
          },
        },
      )

      if (!response.ok) {
        throw new Error(
          `Queue request failed with HTTP ${response.status}.`,
        )
      }

      baselineRunId.current =
        status.jobs[0]?.id ?? null
      pollingStartedAt.current =
        Date.now()

      setStatus((current) =>
        withQueuedJob(current),
      )
      setActionState('queued')
      setMessage(
        'Synchronization queued. Waiting for the worker…',
      )
      setPolling(true)
    } catch {
      setActionState('error')
      setMessage(
        'Unable to queue synchronization.',
      )
    }
  }

  const latestJob =
    status.jobs[0] ?? null
  const events =
    latestJob?.events ?? []

  return (
    <section
      className="dss-github-monitor"
      aria-label={title}
      data-sync-endpoint={
        syncEndpointURL
      }
      data-status-endpoint={
        settingsEndpointURL
      }
    >
      <header className="dss-github-monitor-header">
        <div>
          <p className="dss-github-monitor-eyebrow">
            DSS Feeds
          </p>
          <h2 className="dss-github-monitor-title">
            {title}
          </h2>
          <p className="dss-github-monitor-description">
            Operational state is
            persisted in Payload and
            refreshed without reloading
            this page. The browser never
            contacts GitHub directly.
          </p>
        </div>

        <StatusBadge
          state={
            latestJob?.status ===
              'running' ||
            latestJob?.status ===
              'queued'
              ? latestJob.status
              : status.cache.state
          }
        />
      </header>

      <dl className="dss-github-monitor-metrics">
        <Metric
          label="Cached commits"
          value={String(
            status.cache
              .cachedCommitCount,
          )}
        />
        <Metric
          label="Last generated"
          value={
            <LocalDate
              value={
                status.cache
                  .generatedAt
              }
            />
          }
        />
        <Metric
          label="Next sync"
          value={
            <LocalDate
              value={
                status.cache
                  .nextSyncAt
              }
            />
          }
        />
        <Metric
          label="Last run"
          value={
            latestJob
              ? formatJobStatus(
                  latestJob.status,
                )
              : 'No runs'
          }
        />
        <Metric
          label="Sync attempts"
          value={
            latestJob
              ? String(
                  latestJob.totalTried,
                )
              : '—'
          }
        />
        <Metric
          label="Duration"
          value={
            latestJob
              ? formatDuration(
                  latestJob.durationMs,
                )
              : '—'
          }
        />
        <Metric
          label="Adapter"
          value={
            status.cache
              .adapterVersion ?? '—'
          }
        />
      </dl>

      {status.cache.warnings.length >
        0 && (
        <div
          className="dss-github-monitor-notice"
          role="status"
        >
          {status.cache.warnings.map(
            (warning) => (
              <p key={warning}>
                {warning}
              </p>
            ),
          )}
        </div>
      )}

      <RegenerateGitHubFeedButton
        state={actionState}
        message={message}
        onRefresh={() => {
          void refreshStatus()
        }}
        onRegenerate={() => {
          void regenerateCache()
        }}
      />

      <div className="dss-github-monitor-console">
        <div className="dss-github-monitor-console-header">
          <span>
            Synchronization log
          </span>
          <span>
            {events.length} recent event
            {events.length === 1
              ? ''
              : 's'}
          </span>
        </div>

        <div
          className="dss-github-monitor-console-body"
          aria-live="polite"
        >
          {events.length > 0 ? (
            events.map(
              (event, index) => (
                <div
                  className="dss-github-monitor-log-row"
                  key={`${event.timestamp}-${index}`}
                >
                  <time
                    className="dss-github-monitor-log-time"
                    dateTime={
                      event.timestamp
                    }
                    suppressHydrationWarning
                  >
                    {formatConsoleTime(
                      event.timestamp,
                    )}
                  </time>
                  <span
                    className={`dss-github-monitor-log-level dss-github-monitor-log-level--${event.level}`}
                  >
                    {event.level}
                  </span>
                  <span className="dss-github-monitor-log-message">
                    {event.message}
                    {event.context && (
                      <code className="dss-github-monitor-log-context">
                        {safeStringify(
                          event.context,
                        )}
                      </code>
                    )}
                  </span>
                </div>
              ),
            )
          ) : (
            <p className="dss-github-monitor-empty">
              No synchronization
              events yet.
            </p>
          )}
        </div>
      </div>

      <p className="dss-github-monitor-checked">
        Checked{' '}
        <LocalDate
          value={
            status.checkedAt
          }
        />
      </p>
    </section>
  )
}

function LocalDate({
  value,
}: {
  value: string | null
}) {
  return (
    <time
      dateTime={
        value ?? undefined
      }
      suppressHydrationWarning
    >
      {formatDate(value)}
    </time>
  )
}

function Metric({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="dss-github-monitor-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function StatusBadge({
  state,
}: {
  state: string
}) {
  return (
    <span
      className={`dss-github-monitor-status dss-github-monitor-status--${state}`}
    >
      {state.replace(
        /_/g,
        ' ',
      )}
    </span>
  )
}

async function fetchRuntimeStatus(
  endpointURL: string,
  previous: GitHubFeedAdminStatus,
): Promise<GitHubFeedAdminStatus> {
  const response = await fetch(
    endpointURL,
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept:
          'application/json',
      },
      cache: 'no-store',
    },
  )

  if (!response.ok) {
    throw new Error(
      `Status request failed with HTTP ${response.status}.`,
    )
  }

  const payload =
    (await response.json()) as unknown

  return parseRuntimeStatus(
    payload,
    previous,
    new Date(),
  )
}

function parseRuntimeStatus(
  value: unknown,
  previous: GitHubFeedAdminStatus,
  now: Date,
): GitHubFeedAdminStatus {
  if (!isRecord(value)) {
    throw new TypeError(
      'Invalid GitHub feed status response.',
    )
  }

  const status =
    readJobStatus(
      value.monitorStatus,
    )
  const runId =
    readOptionalString(
      value.monitorRunId,
    )
  const commitCount =
    readNonNegativeInteger(
      value.monitorCommitCount,
      previous.cache
        .cachedCommitCount,
    )
  const generatedAt =
    readDate(
      value.monitorGeneratedAt,
    ) ??
    previous.cache.generatedAt
  const freshUntil =
    readDate(
      value.monitorFreshUntil,
    ) ??
    previous.cache.freshUntil
  const staleUntil =
    readDate(
      value.monitorStaleUntil,
    ) ??
    previous.cache.staleUntil
  const nextSyncAt =
    readDate(
      value.monitorNextSyncAt,
    ) ??
    previous.cache.nextSyncAt
  const cacheState =
    resolveCacheState(
      commitCount,
      freshUntil,
      staleUntil,
      now,
    )
  const events =
    readEvents(
      value.monitorEvents,
    )
  const lastError =
    readOptionalString(
      value.monitorLastError,
    )

  if (
    status === 'error' &&
    lastError &&
    !events.some(
      (event) =>
        event.level === 'error',
    )
  ) {
    events.push({
      level: 'error',
      message: lastError,
      timestamp:
        readDate(
          value.monitorCompletedAt,
        ) ??
        now.toISOString(),
    })
  }

  const job =
    status &&
    status !== 'idle' &&
    runId
      ? {
          id: runId,
          status,
          createdAt:
            readDate(
              value.monitorLastAttemptAt,
            ),
          completedAt:
            readDate(
              value.monitorCompletedAt,
            ),
          totalTried:
            readNonNegativeInteger(
              value.monitorAttemptCount,
              0,
            ),
          durationMs:
            readNonNegativeNumber(
              value.monitorDurationMs,
            ),
          trigger:
            readTrigger(
              value.monitorTrigger,
            ),
          events,
        }
      : null

  return {
    checkedAt:
      now.toISOString(),
    cache: {
      state: cacheState,
      renderable:
        commitCount > 0 &&
        (cacheState ===
          'fresh' ||
          cacheState ===
            'stale'),
      cachedCommitCount:
        commitCount,
      checksum:
        readOptionalString(
          value.monitorChecksum,
        ) ??
        previous.cache.checksum,
      adapterVersion:
        readOptionalString(
          value.monitorAdapterVersion,
        ) ??
        previous.cache
          .adapterVersion,
      generatedAt,
      freshUntil,
      staleUntil,
      nextSyncAt,
      warnings:
        previous.cache.warnings,
    },
    jobs:
      job ? [job] : [],
    jobsAvailable: true,
  }
}

function withQueuedJob(
  status: GitHubFeedAdminStatus,
): GitHubFeedAdminStatus {
  const timestamp =
    new Date().toISOString()

  return {
    ...status,
    checkedAt: timestamp,
    jobs: [
      {
        id:
          `queued:${timestamp}`,
        status: 'queued',
        createdAt: timestamp,
        completedAt: null,
        totalTried:
          status.jobs[0]
            ?.totalTried ?? 0,
        durationMs: null,
        trigger: 'endpoint',
        events: [
          {
            level: 'info',
            message:
              'Synchronization was queued from the admin monitor.',
            timestamp,
          },
        ],
      },
    ],
    jobsAvailable: true,
  }
}

function resolveCacheState(
  commitCount: number,
  freshUntil: string | null,
  staleUntil: string | null,
  now: Date,
): GitHubFeedAdminStatus['cache']['state'] {
  if (commitCount === 0) {
    return 'empty'
  }

  const nowTimestamp =
    now.getTime()
  const freshTimestamp =
    freshUntil
      ? Date.parse(freshUntil)
      : Number.NaN
  const staleTimestamp =
    staleUntil
      ? Date.parse(staleUntil)
      : Number.NaN

  if (
    !Number.isNaN(
      freshTimestamp,
    ) &&
    nowTimestamp <=
      freshTimestamp
  ) {
    return 'fresh'
  }

  if (
    !Number.isNaN(
      staleTimestamp,
    ) &&
    nowTimestamp <=
      staleTimestamp
  ) {
    return 'stale'
  }

  return 'expired'
}

function toActionState(
  status:
    GitHubFeedAdminJobStatus,
): GitHubFeedMonitorActionState {
  if (status === 'queued') {
    return 'queued'
  }

  if (status === 'running') {
    return 'running'
  }

  if (status === 'error') {
    return 'error'
  }

  return 'success'
}

function isTerminalStatus(
  status:
    GitHubFeedAdminJobStatus,
): boolean {
  return (
    status === 'success' ||
    status === 'skipped' ||
    status === 'error'
  )
}

function formatJobStatus(
  value:
    GitHubFeedAdminJobStatus,
): string {
  return (
    value[0]!.toUpperCase() +
    value.slice(1)
  )
}

function formatDate(
  value: string | null,
): string {
  if (!value) {
    return '—'
  }

  const timestamp =
    Date.parse(value)

  if (Number.isNaN(timestamp)) {
    return '—'
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle: 'medium',
      timeStyle: 'short',
    },
  ).format(
    new Date(timestamp),
  )
}

function formatConsoleTime(
  value: string,
): string {
  const timestamp =
    Date.parse(value)

  if (Number.isNaN(timestamp)) {
    return '--:--:--'
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    },
  ).format(
    new Date(timestamp),
  )
}

function formatDuration(
  value: number | null,
): string {
  if (value === null) {
    return '—'
  }

  if (value < 1000) {
    return `${value} ms`
  }

  return `${(
    value / 1000
  ).toFixed(1)} s`
}

function safeStringify(
  value: Readonly<
    Record<string, unknown>
  >,
): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}

function readEvents(
  value: unknown,
): GitHubFeedAdminEvent[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap(
    (entry) => {
      if (!isRecord(entry)) {
        return []
      }

      const level =
        readEventLevel(
          entry.level,
        )
      const message =
        readOptionalString(
          entry.message,
        )
      const timestamp =
        readDate(
          entry.timestamp,
        )

      if (
        !level ||
        !message ||
        !timestamp
      ) {
        return []
      }

      return [
        {
          level,
          message,
          timestamp,
          ...(isRecord(
            entry.context,
          )
            ? {
                context:
                  entry.context,
              }
            : {}),
        },
      ]
    },
  )
}

function readJobStatus(
  value: unknown,
): (
  | GitHubFeedAdminJobStatus
  | 'idle'
  | null
) {
  return value === 'idle' ||
    value === 'running' ||
    value === 'success' ||
    value === 'skipped' ||
    value === 'error'
    ? value
    : null
}

function readTrigger(
  value: unknown,
): GitHubFeedAdminJob['trigger'] {
  return value === 'schedule' ||
    value === 'manual' ||
    value === 'endpoint'
    ? value
    : null
}

function readEventLevel(
  value: unknown,
): GitHubFeedAdminEvent['level'] | null {
  return value === 'info' ||
    value === 'success' ||
    value === 'warning' ||
    value === 'error'
    ? value
    : null
}

function readOptionalString(
  value: unknown,
): string | null {
  return typeof value === 'string' &&
    value.trim().length > 0
    ? value.trim()
    : null
}

function readDate(
  value: unknown,
): string | null {
  const raw =
    readOptionalString(value)

  if (!raw) {
    return null
  }

  const timestamp =
    Date.parse(raw)

  return Number.isNaN(timestamp)
    ? null
    : new Date(
        timestamp,
      ).toISOString()
}

function readNonNegativeInteger(
  value: unknown,
  fallback: number,
): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : fallback
}

function readNonNegativeNumber(
  value: unknown,
): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null
  )
}
