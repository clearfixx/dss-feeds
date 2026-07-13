import type {
  ReactNode,
} from 'react'
import type { Payload } from 'payload'

import '../../admin.css'

import {
  readGitHubFeed,
} from '../payload/read.js'
import {
  RegenerateGitHubFeedButton,
} from './RegenerateButton.js'
import type {
  GitHubFeedAdminEvent,
  GitHubFeedAdminJob,
  GitHubFeedAdminJobStatus,
  GitHubFeedAdminStatus,
} from './types.js'

export interface GitHubFeedMonitorProps {
  payload: Payload
  cacheSlug?: string
  cacheKey?: string
  taskSlug?: string
  syncEndpointPath?: string
  jobLimit?: number
  title?: string
}

interface JobsPayloadClient {
  find(args: {
    collection: string
    where: {
      taskSlug: {
        equals: string
      }
    }
    sort: string
    limit: number
    depth: number
    pagination: boolean
    overrideAccess: boolean
  }): Promise<{
    docs: unknown[]
  }>
}

const DEFAULT_CACHE_SLUG =
  'dss-github-feed-cache'
const DEFAULT_CACHE_KEY =
  'github:default'
const DEFAULT_TASK_SLUG =
  'dss-github-feed-sync'
const DEFAULT_SYNC_ENDPOINT_PATH =
  '/dss-github-feed/sync'
const DEFAULT_JOB_LIMIT = 5
const MAX_JOB_LIMIT = 20

export async function GitHubFeedMonitor({
  payload,
  cacheSlug =
    DEFAULT_CACHE_SLUG,
  cacheKey =
    DEFAULT_CACHE_KEY,
  taskSlug =
    DEFAULT_TASK_SLUG,
  syncEndpointPath =
    DEFAULT_SYNC_ENDPOINT_PATH,
  jobLimit =
    DEFAULT_JOB_LIMIT,
  title = 'GitHub Feed Monitor',
}: GitHubFeedMonitorProps): Promise<ReactNode> {
  const status =
    await loadGitHubFeedAdminStatus({
      payload,
      cacheSlug,
      cacheKey,
      taskSlug,
      jobLimit,
    })
  const endpointURL =
    buildPayloadEndpointURL(
      payload,
      syncEndpointPath,
    )
  const latestJob =
    status.jobs[0] ?? null
  const events =
    status.jobs.flatMap(
      (job) => job.events,
    )

  return (
    <section
      className="dss-github-monitor"
      aria-label={title}
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
            Operational status is read
            from the local Payload cache
            and job queue. This panel does
            not contact GitHub.
          </p>
        </div>

        <StatusBadge
          state={
            latestJob?.status ===
              'running'
              ? 'running'
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
          value={formatDate(
            status.cache.generatedAt,
          )}
        />
        <Metric
          label="Next sync"
          value={formatDate(
            status.cache.nextSyncAt,
          )}
        />
        <Metric
          label="Last job"
          value={
            latestJob
              ? formatJobStatus(
                  latestJob.status,
                )
              : 'No runs'
          }
        />
        <Metric
          label="Attempts"
          value={
            latestJob
              ? String(
                  latestJob.totalTried,
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
        endpointURL={endpointURL}
      />

      <div className="dss-github-monitor-console">
        <div className="dss-github-monitor-console-header">
          <span>
            Synchronization log
          </span>
          <span>
            {status.jobsAvailable
              ? `${status.jobs.length} recent job${
                  status.jobs.length ===
                  1
                    ? ''
                    : 's'
                }`
              : 'Job history unavailable'}
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
              No synchronization events yet.
            </p>
          )}
        </div>
      </div>

      <p className="dss-github-monitor-checked">
        Checked{' '}
        {formatDate(status.checkedAt)}
      </p>
    </section>
  )
}

export async function loadGitHubFeedAdminStatus(
  options: {
    payload: Payload
    cacheSlug: string
    cacheKey: string
    taskSlug: string
    jobLimit?: number
    now?: Date
  },
): Promise<GitHubFeedAdminStatus> {
  const now =
    options.now ?? new Date()
  const jobLimit =
    normalizeJobLimit(
      options.jobLimit,
    )

  const cache =
    await readGitHubFeed({
      payload: options.payload,
      cacheSlug:
        options.cacheSlug,
      cacheKey: options.cacheKey,
      commitCount: 100,
      now,
    })

  let jobs: GitHubFeedAdminJob[] = []
  let jobsAvailable = true

  try {
    const client =
      options.payload as unknown as JobsPayloadClient
    const result =
      await client.find({
        collection:
          'payload-jobs',
        where: {
          taskSlug: {
            equals:
              options.taskSlug,
          },
        },
        sort: '-createdAt',
        limit: jobLimit,
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })

    jobs = result.docs.flatMap(
      (document) => {
        const job =
          parseJobDocument(
            document,
            options.taskSlug,
          )

        return job ? [job] : []
      },
    )
  } catch {
    jobsAvailable = false
  }

  return {
    checkedAt: now.toISOString(),
    cache: {
      state: cache.state,
      renderable:
        cache.renderable,
      cachedCommitCount:
        cache.cachedCommitCount,
      checksum: cache.checksum,
      adapterVersion:
        cache.adapterVersion,
      generatedAt:
        cache.generatedAt,
      freshUntil:
        cache.freshUntil,
      staleUntil:
        cache.staleUntil,
      nextSyncAt:
        cache.nextSyncAt,
      warnings: cache.warnings,
    },
    jobs,
    jobsAvailable,
  }
}

function parseJobDocument(
  value: unknown,
  taskSlug: string,
): GitHubFeedAdminJob | null {
  if (!isRecord(value)) {
    return null
  }

  const id =
    readStringOrNumber(value.id)

  if (!id) {
    return null
  }

  const createdAt =
    readDate(value.createdAt)
  const completedAt =
    readDate(value.completedAt)
  const hasError =
    value.hasError === true
  const processing =
    value.processing === true
  const totalTried =
    readNonNegativeInteger(
      value.totalTried,
    )
  const status =
    resolveJobStatus({
      hasError,
      processing,
      completedAt,
    })

  const events = [
    ...readJobLog(value.log),
    ...readTaskOutputEvents(
      value.taskStatus,
      taskSlug,
    ),
  ].sort(
    (left, right) =>
      Date.parse(left.timestamp) -
      Date.parse(right.timestamp),
  )

  if (
    hasError &&
    !events.some(
      (event) =>
        event.level === 'error',
    )
  ) {
    events.push({
      level: 'error',
      message:
        'Synchronization job failed.',
      timestamp:
        completedAt ??
        createdAt ??
        new Date(0).toISOString(),
    })
  }

  return {
    id,
    status,
    createdAt,
    completedAt,
    totalTried,
    events,
  }
}

function readJobLog(
  value: unknown,
): GitHubFeedAdminEvent[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }

    const message =
      readNonEmptyString(
        entry.message,
      )
    const timestamp =
      readDate(entry.createdAt)

    if (!message || !timestamp) {
      return []
    }

    return [
      {
        level: 'info' as const,
        message,
        timestamp,
      },
    ]
  })
}

function readTaskOutputEvents(
  value: unknown,
  taskSlug: string,
): GitHubFeedAdminEvent[] {
  if (!isRecord(value)) {
    return []
  }

  const taskState =
    value[taskSlug]

  if (!isRecord(taskState)) {
    return []
  }

  return Object.values(
    taskState,
  ).flatMap((attempt) => {
    if (!isRecord(attempt)) {
      return []
    }

    const output =
      attempt.output

    if (!isRecord(output)) {
      return []
    }

    return parseOutputEvents(
      output.events,
    )
  })
}

function parseOutputEvents(
  value: unknown,
): GitHubFeedAdminEvent[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }

    const level =
      readEventLevel(
        entry.level,
      )
    const message =
      readNonEmptyString(
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
  })
}

function resolveJobStatus(
  input: {
    hasError: boolean
    processing: boolean
    completedAt: string | null
  },
): GitHubFeedAdminJobStatus {
  if (input.hasError) {
    return 'error'
  }

  if (input.processing) {
    return 'running'
  }

  if (input.completedAt) {
    return 'success'
  }

  return 'queued'
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

function Metric({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="dss-github-monitor-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function buildPayloadEndpointURL(
  payload: Payload,
  endpointPath: string,
): string {
  const serverURL =
    payload.config.serverURL ?? ''
  const apiRoute =
    payload.config.routes.api

  return joinURLParts(
    serverURL,
    apiRoute,
    endpointPath,
  )
}

function joinURLParts(
  ...parts: string[]
): string {
  return parts
    .filter(Boolean)
    .map((part, index) => {
      if (index === 0) {
        return part.replace(
          /\/$/,
          '',
        )
      }

      return `/${part.replace(
        /^\/+|\/+$/g,
        '',
      )}`
    })
    .join('')
}

function normalizeJobLimit(
  value: number | undefined,
): number {
  const resolved =
    value ?? DEFAULT_JOB_LIMIT

  if (
    !Number.isInteger(resolved) ||
    resolved < 1 ||
    resolved > MAX_JOB_LIMIT
  ) {
    throw new RangeError(
      `jobLimit must be an integer between 1 and ${MAX_JOB_LIMIT}.`,
    )
  }

  return resolved
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
    'en',
    {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    },
  ).format(new Date(timestamp))
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
    'en',
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone: 'UTC',
    },
  ).format(new Date(timestamp))
}

function formatJobStatus(
  value: GitHubFeedAdminJobStatus,
): string {
  return (
    value[0]!.toUpperCase() +
    value.slice(1)
  )
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

function readStringOrNumber(
  value: unknown,
): string | null {
  if (
    typeof value === 'string' &&
    value.length > 0
  ) {
    return value
  }

  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    return String(value)
  }

  return null
}

function readNonEmptyString(
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
    readNonEmptyString(value)

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
): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : 0
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null
  )
}
