import type {
  ReactNode,
} from 'react'
import type { Payload } from 'payload'

import '../../admin.css'

import {
  readGitHubFeed,
} from '../payload/read.js'
import {
  readGitHubFeedRuntimeState,
} from '../payload/state.js'
import {
  GitHubFeedMonitorClient,
} from './GitHubFeedMonitorClient.js'
import type {
  GitHubFeedAdminEvent,
  GitHubFeedAdminJob,
  GitHubFeedAdminJobStatus,
  GitHubFeedAdminStatus,
} from './types.js'

export interface GitHubFeedMonitorProps {
  payload: Payload
  settingsSlug?: string
  cacheSlug?: string
  cacheKey?: string
  taskSlug?: string
  syncEndpointPath?: string
  jobLimit?: number
  pollIntervalMs?: number
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

const DEFAULT_SETTINGS_SLUG =
  'dss-github-feed-settings'
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
  settingsSlug =
    DEFAULT_SETTINGS_SLUG,
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
  pollIntervalMs = 1500,
  title = 'GitHub Feed Monitor',
}: GitHubFeedMonitorProps): Promise<ReactNode> {
  const status =
    await loadGitHubFeedAdminStatus({
      payload,
      settingsSlug,
      cacheSlug,
      cacheKey,
      taskSlug,
      jobLimit,
    })
  const syncEndpointURL =
    buildPayloadEndpointURL(
      payload,
      syncEndpointPath,
    )
  const settingsEndpointURL =
    buildPayloadEndpointURL(
      payload,
      `/globals/${settingsSlug}`,
    )

  return (
    <GitHubFeedMonitorClient
      initialStatus={status}
      syncEndpointURL={
        syncEndpointURL
      }
      settingsEndpointURL={
        settingsEndpointURL
      }
      title={title}
      pollIntervalMs={
        pollIntervalMs
      }
    />
  )
}

export async function loadGitHubFeedAdminStatus(
  options: {
    payload: Payload
    settingsSlug?: string
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

  const [cache, runtime] =
    await Promise.all([
      readGitHubFeed({
        payload:
          options.payload,
        cacheSlug:
          options.cacheSlug,
        cacheKey:
          options.cacheKey,
        commitCount: 100,
        now,
      }),
      readGitHubFeedRuntimeState({
        payload:
          options.payload,
        settingsSlug:
          options.settingsSlug,
      }),
    ])

  let queueJobs:
    GitHubFeedAdminJob[] = []
  let queueAvailable = true

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

    queueJobs =
      result.docs.flatMap(
        (document) => {
          const job =
            parseJobDocument(
              document,
              options.taskSlug,
            )

          return job
            ? [job]
            : []
        },
      )
  } catch {
    queueAvailable = false
  }

  const activeQueueJob =
    queueJobs.find(
      (job) =>
        job.status ===
          'queued' ||
        job.status ===
          'running',
    ) ?? null
  const persistentJob =
    runtime &&
    runtime.status !== 'idle' &&
    runtime.runId
      ? {
          id: runtime.runId,
          status:
            runtime.status,
          createdAt:
            runtime.lastAttemptAt,
          completedAt:
            runtime.completedAt,
          totalTried:
            runtime.attemptCount,
          durationMs:
            runtime.durationMs,
          trigger:
            runtime.trigger,
          events:
            runtime.events,
        }
      : null

  const jobs =
    activeQueueJob
      ? [
          activeQueueJob,
          ...(persistentJob &&
          persistentJob.id !==
            activeQueueJob.id
            ? [persistentJob]
            : []),
        ]
      : persistentJob
        ? [persistentJob]
        : queueJobs

  return {
    checkedAt:
      now.toISOString(),
    cache: {
      state: cache.state,
      renderable:
        cache.renderable,
      cachedCommitCount:
        cache.cachedCommitCount,
      checksum:
        cache.checksum,
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
      warnings:
        cache.warnings,
    },
    jobs,
    jobsAvailable:
      Boolean(runtime) ||
      queueAvailable,
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
    readStringOrNumber(
      value.id,
    )

  if (!id) {
    return null
  }

  const createdAt =
    readDate(value.createdAt)
  const completedAt =
    readDate(
      value.completedAt,
    )
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
    ...readJobLog(
      value.log,
    ),
    ...readTaskOutputEvents(
      value.taskStatus,
      taskSlug,
    ),
  ].sort(
    (left, right) =>
      Date.parse(
        left.timestamp,
      ) -
      Date.parse(
        right.timestamp,
      ),
  )

  if (
    hasError &&
    !events.some(
      (event) =>
        event.level ===
        'error',
    )
  ) {
    events.push({
      level: 'error',
      message:
        'Synchronization job failed.',
      timestamp:
        completedAt ??
        createdAt ??
        new Date(0)
          .toISOString(),
    })
  }

  return {
    id,
    status,
    createdAt,
    completedAt,
    totalTried,
    durationMs:
      calculateDuration(
        createdAt,
        completedAt,
      ),
    trigger: null,
    events,
  }
}

function readJobLog(
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

      const message =
        readNonEmptyString(
          entry.message,
        )
      const timestamp =
        readDate(
          entry.createdAt,
        )

      if (
        !message ||
        !timestamp
      ) {
        return []
      }

      return [
        {
          level:
            'info' as const,
          message,
          timestamp,
        },
      ]
    },
  )
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
    },
  )
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
    .map(
      (part, index) => {
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
      },
    )
    .join('')
}

function normalizeJobLimit(
  value: number | undefined,
): number {
  const resolved =
    value ??
    DEFAULT_JOB_LIMIT

  if (
    !Number.isInteger(
      resolved,
    ) ||
    resolved < 1 ||
    resolved >
      MAX_JOB_LIMIT
  ) {
    throw new RangeError(
      `jobLimit must be an integer between 1 and ${MAX_JOB_LIMIT}.`,
    )
  }

  return resolved
}

function calculateDuration(
  startedAt: string | null,
  completedAt: string | null,
): number | null {
  if (
    !startedAt ||
    !completedAt
  ) {
    return null
  }

  const started =
    Date.parse(startedAt)
  const completed =
    Date.parse(completedAt)

  if (
    Number.isNaN(started) ||
    Number.isNaN(completed)
  ) {
    return null
  }

  return Math.max(
    0,
    completed - started,
  )
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
    typeof value ===
      'string' &&
    value.length > 0
  ) {
    return value
  }

  if (
    typeof value ===
      'number' &&
    Number.isFinite(value)
  ) {
    return String(value)
  }

  return null
}

function readNonEmptyString(
  value: unknown,
): string | null {
  return typeof value ===
    'string' &&
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

  return Number.isNaN(
    timestamp,
  )
    ? null
    : new Date(
        timestamp,
      ).toISOString()
}

function readNonNegativeInteger(
  value: unknown,
): number {
  return typeof value ===
    'number' &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : 0
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value ===
      'object' &&
    value !== null
  )
}
