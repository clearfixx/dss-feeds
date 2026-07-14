import { randomUUID } from 'node:crypto'

import type { Payload } from 'payload'

import {
  GITHUB_FEED_ADAPTER_VERSION,
  type GitHubFeedSyncLogEntry,
  type GitHubFeedSyncResult,
} from './sync.js'

export type GitHubFeedRuntimeStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'skipped'
  | 'error'

export type GitHubFeedRuntimeTrigger =
  | 'schedule'
  | 'manual'
  | 'endpoint'

export interface GitHubFeedRuntimeState {
  status: GitHubFeedRuntimeStatus
  runId: string | null
  trigger: GitHubFeedRuntimeTrigger | null
  attemptCount: number
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  completedAt: string | null
  durationMs: number | null
  commitCount: number
  checksum: string | null
  generatedAt: string | null
  freshUntil: string | null
  staleUntil: string | null
  nextSyncAt: string | null
  adapterVersion: string | null
  lastError: string | null
  events: readonly GitHubFeedSyncLogEntry[]
}

export interface GitHubFeedRunContext {
  runId: string
  trigger: GitHubFeedRuntimeTrigger
  attemptCount: number
  startedAt: string
  previousEvents: readonly GitHubFeedSyncLogEntry[]
  previousLastSuccessAt: string | null
}

export interface ReadGitHubFeedRuntimeStateOptions {
  payload: Payload
  settingsSlug?: string
}

export interface BeginGitHubFeedRunOptions
  extends ReadGitHubFeedRuntimeStateOptions {
  trigger: GitHubFeedRuntimeTrigger
  now: Date
}

export interface CompleteGitHubFeedRunOptions
  extends ReadGitHubFeedRuntimeStateOptions {
  context: GitHubFeedRunContext
  result: GitHubFeedSyncResult
  events: readonly GitHubFeedSyncLogEntry[]
  completedAt: Date
}

export interface FailGitHubFeedRunOptions
  extends ReadGitHubFeedRuntimeStateOptions {
  context: GitHubFeedRunContext
  events: readonly GitHubFeedSyncLogEntry[]
  completedAt: Date
  error: unknown
}

interface RuntimePayloadClient {
  findGlobal?: (args: {
    slug: string
    overrideAccess: boolean
  }) => Promise<unknown>

  updateGlobal?: (args: {
    slug: string
    data: Record<string, unknown>
    overrideAccess: boolean
  }) => Promise<unknown>
}

const DEFAULT_SETTINGS_SLUG =
  'dss-github-feed-settings'
const MAX_RUNTIME_EVENTS = 20

export async function readGitHubFeedRuntimeState(
  options: ReadGitHubFeedRuntimeStateOptions,
): Promise<GitHubFeedRuntimeState | null> {
  const client =
    options.payload as unknown as RuntimePayloadClient

  if (
    typeof client.findGlobal !==
    'function'
  ) {
    return null
  }

  try {
    const value =
      await client.findGlobal({
        slug:
          options.settingsSlug ??
          DEFAULT_SETTINGS_SLUG,
        overrideAccess: true,
      })

    return parseRuntimeState(value)
  } catch {
    return null
  }
}

export async function beginGitHubFeedRun(
  options: BeginGitHubFeedRunOptions,
): Promise<GitHubFeedRunContext> {
  assertValidDate(options.now)

  const previous =
    await readGitHubFeedRuntimeState(
      options,
    )
  const startedAt =
    options.now.toISOString()
  const runId = randomUUID()
  const attemptCount =
    (previous?.attemptCount ?? 0) + 1
  const startEvent: GitHubFeedSyncLogEntry = {
    level: 'info',
    message:
      `Synchronization trigger: ${options.trigger}.`,
    timestamp: startedAt,
  }
  const runtimeEvents =
    keepLatestEvents([
      ...(previous?.events ?? []),
      startEvent,
    ])

  const context: GitHubFeedRunContext = {
    runId,
    trigger: options.trigger,
    attemptCount,
    startedAt,
    previousEvents: runtimeEvents,
    previousLastSuccessAt:
      previous?.lastSuccessAt ?? null,
  }

  await updateRuntimeState(
    options.payload,
    options.settingsSlug,
    {
      monitorStatus: 'running',
      monitorRunId: runId,
      monitorTrigger:
        options.trigger,
      monitorAttemptCount:
        attemptCount,
      monitorLastAttemptAt:
        startedAt,
      monitorCompletedAt: null,
      monitorDurationMs: null,
      monitorLastError: null,
      monitorEvents:
        toPayloadEvents(
          runtimeEvents,
        ),
    },
  )

  return context
}

export async function completeGitHubFeedRun(
  options: CompleteGitHubFeedRunOptions,
): Promise<void> {
  assertValidDate(options.completedAt)

  const completedAt =
    options.completedAt.toISOString()
  const status =
    options.result.status
  const lastSuccessAt =
    status === 'success'
      ? completedAt
      : options.context
          .previousLastSuccessAt
  const runtimeEvents =
    keepLatestEvents([
      ...options.context.previousEvents,
      ...options.events,
    ])

  await updateRuntimeState(
    options.payload,
    options.settingsSlug,
    {
      monitorStatus: status,
      monitorRunId:
        options.context.runId,
      monitorTrigger:
        options.context.trigger,
      monitorAttemptCount:
        options.context.attemptCount,
      monitorLastAttemptAt:
        options.context.startedAt,
      monitorLastSuccessAt:
        lastSuccessAt,
      monitorCompletedAt:
        completedAt,
      monitorDurationMs:
        calculateDuration(
          options.context.startedAt,
          completedAt,
        ),
      monitorCommitCount:
        options.result.commitCount,
      monitorChecksum:
        options.result.checksum,
      monitorGeneratedAt:
        options.result.generatedAt,
      monitorFreshUntil:
        options.result.freshUntil,
      monitorStaleUntil:
        options.result.staleUntil,
      monitorNextSyncAt:
        options.result.nextSyncAt,
      monitorAdapterVersion:
        GITHUB_FEED_ADAPTER_VERSION,
      monitorLastError: null,
      monitorEvents:
        toPayloadEvents(
          runtimeEvents,
        ),
    },
  )
}

export async function failGitHubFeedRun(
  options: FailGitHubFeedRunOptions,
): Promise<void> {
  assertValidDate(options.completedAt)

  const completedAt =
    options.completedAt.toISOString()
  const message =
    readErrorMessage(options.error)
  const events = [
    ...options.events,
  ]

  if (
    !events.some(
      (event) =>
        event.level === 'error',
    )
  ) {
    events.push({
      level: 'error',
      message,
      timestamp: completedAt,
    })
  }

  const runtimeEvents =
    keepLatestEvents([
      ...options.context.previousEvents,
      ...events,
    ])

  await updateRuntimeState(
    options.payload,
    options.settingsSlug,
    {
      monitorStatus: 'error',
      monitorRunId:
        options.context.runId,
      monitorTrigger:
        options.context.trigger,
      monitorAttemptCount:
        options.context.attemptCount,
      monitorLastAttemptAt:
        options.context.startedAt,
      monitorLastSuccessAt:
        options.context
          .previousLastSuccessAt,
      monitorCompletedAt:
        completedAt,
      monitorDurationMs:
        calculateDuration(
          options.context.startedAt,
          completedAt,
        ),
      monitorLastError:
        message,
      monitorEvents:
        toPayloadEvents(
          runtimeEvents,
        ),
    },
  )
}

function parseRuntimeState(
  value: unknown,
): GitHubFeedRuntimeState {
  if (!isRecord(value)) {
    return createEmptyRuntimeState()
  }

  return {
    status:
      readRuntimeStatus(
        value.monitorStatus,
      ) ?? 'idle',
    runId:
      readOptionalString(
        value.monitorRunId,
      ),
    trigger:
      readRuntimeTrigger(
        value.monitorTrigger,
      ),
    attemptCount:
      readNonNegativeInteger(
        value.monitorAttemptCount,
      ),
    lastAttemptAt:
      readDate(
        value.monitorLastAttemptAt,
      ),
    lastSuccessAt:
      readDate(
        value.monitorLastSuccessAt,
      ),
    completedAt:
      readDate(
        value.monitorCompletedAt,
      ),
    durationMs:
      readNullableNonNegativeNumber(
        value.monitorDurationMs,
      ),
    commitCount:
      readNonNegativeInteger(
        value.monitorCommitCount,
      ),
    checksum:
      readOptionalString(
        value.monitorChecksum,
      ),
    generatedAt:
      readDate(
        value.monitorGeneratedAt,
      ),
    freshUntil:
      readDate(
        value.monitorFreshUntil,
      ),
    staleUntil:
      readDate(
        value.monitorStaleUntil,
      ),
    nextSyncAt:
      readDate(
        value.monitorNextSyncAt,
      ),
    adapterVersion:
      readOptionalString(
        value.monitorAdapterVersion,
      ),
    lastError:
      readOptionalString(
        value.monitorLastError,
      ),
    events:
      readRuntimeEvents(
        value.monitorEvents,
      ),
  }
}

function createEmptyRuntimeState():
  GitHubFeedRuntimeState {
  return {
    status: 'idle',
    runId: null,
    trigger: null,
    attemptCount: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    completedAt: null,
    durationMs: null,
    commitCount: 0,
    checksum: null,
    generatedAt: null,
    freshUntil: null,
    staleUntil: null,
    nextSyncAt: null,
    adapterVersion: null,
    lastError: null,
    events: [],
  }
}

async function updateRuntimeState(
  payload: Payload,
  settingsSlug: string | undefined,
  data: Record<string, unknown>,
): Promise<void> {
  const client =
    payload as unknown as RuntimePayloadClient

  if (
    typeof client.updateGlobal !==
    'function'
  ) {
    return
  }

  try {
    await client.updateGlobal({
      slug:
        settingsSlug ??
        DEFAULT_SETTINGS_SLUG,
      data,
      overrideAccess: true,
    })
  } catch {
    // Monitoring must never make provider synchronization fail.
  }
}

function toPayloadEvents(
  events:
    readonly GitHubFeedSyncLogEntry[],
): Record<string, unknown>[] {
  return events.map((event) => ({
    level: event.level,
    message: event.message,
    timestamp: event.timestamp,
    ...(event.context
      ? {
          context:
            event.context,
        }
      : {}),
  }))
}

function keepLatestEvents(
  events:
    readonly GitHubFeedSyncLogEntry[],
): GitHubFeedSyncLogEntry[] {
  const seen = new Set<string>()

  return events
    .filter(
      (event) =>
        Boolean(event.message) &&
        Boolean(
          readDate(
            event.timestamp,
          ),
        ),
    )
    .filter((event) => {
      const identity =
        createEventIdentity(event)

      if (seen.has(identity)) {
        return false
      }

      seen.add(identity)

      return true
    })
    .slice(-MAX_RUNTIME_EVENTS)
}

function createEventIdentity(
  event: GitHubFeedSyncLogEntry,
): string {
  let context = ''

  if (event.context) {
    try {
      context =
        JSON.stringify(
          event.context,
        )
    } catch {
      context = '[unserializable]'
    }
  }

  return [
    event.level,
    event.message,
    event.timestamp,
    context,
  ].join('\u0000')
}

function readRuntimeEvents(
  value: unknown,
): GitHubFeedSyncLogEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }

    const level =
      readLogLevel(entry.level)
    const message =
      readOptionalString(
        entry.message,
      )
    const timestamp =
      readDate(entry.timestamp)

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

function calculateDuration(
  startedAt: string,
  completedAt: string,
): number {
  const started =
    Date.parse(startedAt)
  const completed =
    Date.parse(completedAt)

  if (
    Number.isNaN(started) ||
    Number.isNaN(completed)
  ) {
    return 0
  }

  return Math.max(
    0,
    completed - started,
  )
}

function readErrorMessage(
  error: unknown,
): string {
  if (
    error instanceof Error &&
    error.message.trim().length > 0
  ) {
    return error.message.trim()
  }

  return 'GitHub synchronization failed.'
}

function assertValidDate(
  value: Date,
): void {
  if (
    Number.isNaN(value.getTime())
  ) {
    throw new TypeError(
      'Runtime timestamp must be a valid Date.',
    )
  }
}

function readRuntimeStatus(
  value: unknown,
): GitHubFeedRuntimeStatus | null {
  return value === 'idle' ||
    value === 'running' ||
    value === 'success' ||
    value === 'skipped' ||
    value === 'error'
    ? value
    : null
}

function readRuntimeTrigger(
  value: unknown,
): GitHubFeedRuntimeTrigger | null {
  return value === 'schedule' ||
    value === 'manual' ||
    value === 'endpoint'
    ? value
    : null
}

function readLogLevel(
  value: unknown,
): GitHubFeedSyncLogEntry['level'] | null {
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
): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : 0
}

function readNullableNonNegativeNumber(
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
