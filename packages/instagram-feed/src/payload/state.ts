import { randomUUID } from 'node:crypto'

import type { Payload } from 'payload'

import {
  INSTAGRAM_FEED_ADAPTER_VERSION,
  type InstagramFeedSyncLogEntry,
  type InstagramFeedSyncResult,
} from './sync.js'

export type InstagramFeedRuntimeStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'skipped'
  | 'error'

export type InstagramFeedRuntimeTrigger =
  | 'schedule'
  | 'manual'
  | 'endpoint'

export interface InstagramFeedRuntimeState {
  status: InstagramFeedRuntimeStatus
  runId: string | null
  trigger: InstagramFeedRuntimeTrigger | null
  attemptCount: number
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  completedAt: string | null
  durationMs: number | null
  postCount: number
  checksum: string | null
  generatedAt: string | null
  freshUntil: string | null
  staleUntil: string | null
  nextSyncAt: string | null
  adapterVersion: string | null
  lastError: string | null
  events: readonly InstagramFeedSyncLogEntry[]
}

export interface InstagramFeedRunContext {
  runId: string
  trigger: InstagramFeedRuntimeTrigger
  attemptCount: number
  startedAt: string
  previousEvents: readonly InstagramFeedSyncLogEntry[]
  previousLastSuccessAt: string | null
}

export interface ReadInstagramFeedRuntimeStateOptions {
  payload: Payload
  settingsSlug?: string
}

export interface BeginInstagramFeedRunOptions
  extends ReadInstagramFeedRuntimeStateOptions {
  trigger: InstagramFeedRuntimeTrigger
  now: Date
}

export interface CompleteInstagramFeedRunOptions
  extends ReadInstagramFeedRuntimeStateOptions {
  context: InstagramFeedRunContext
  result: InstagramFeedSyncResult
  events: readonly InstagramFeedSyncLogEntry[]
  completedAt: Date
}

export interface FailInstagramFeedRunOptions
  extends ReadInstagramFeedRuntimeStateOptions {
  context: InstagramFeedRunContext
  events: readonly InstagramFeedSyncLogEntry[]
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
  'dss-instagram-feed-settings'
const MAX_RUNTIME_EVENTS = 20

export async function readInstagramFeedRuntimeState(
  options: ReadInstagramFeedRuntimeStateOptions,
): Promise<InstagramFeedRuntimeState | null> {
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

export async function beginInstagramFeedRun(
  options: BeginInstagramFeedRunOptions,
): Promise<InstagramFeedRunContext> {
  assertValidDate(options.now)

  const previous =
    await readInstagramFeedRuntimeState(
      options,
    )
  const startedAt =
    options.now.toISOString()
  const runId = randomUUID()
  const attemptCount =
    (previous?.attemptCount ?? 0) + 1
  const startEvent: InstagramFeedSyncLogEntry = {
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

  const context: InstagramFeedRunContext = {
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

export async function completeInstagramFeedRun(
  options: CompleteInstagramFeedRunOptions,
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
      monitorPostCount:
        options.result.postCount,
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
        INSTAGRAM_FEED_ADAPTER_VERSION,
      monitorLastError: null,
      monitorEvents:
        toPayloadEvents(
          runtimeEvents,
        ),
    },
  )
}

export async function failInstagramFeedRun(
  options: FailInstagramFeedRunOptions,
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
): InstagramFeedRuntimeState {
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
    postCount:
      readNonNegativeInteger(
        value.monitorPostCount,
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
  InstagramFeedRuntimeState {
  return {
    status: 'idle',
    runId: null,
    trigger: null,
    attemptCount: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    completedAt: null,
    durationMs: null,
    postCount: 0,
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
    readonly InstagramFeedSyncLogEntry[],
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
    readonly InstagramFeedSyncLogEntry[],
): InstagramFeedSyncLogEntry[] {
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
  event: InstagramFeedSyncLogEntry,
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
): InstagramFeedSyncLogEntry[] {
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

  return 'Instagram synchronization failed.'
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
): InstagramFeedRuntimeStatus | null {
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
): InstagramFeedRuntimeTrigger | null {
  return value === 'schedule' ||
    value === 'manual' ||
    value === 'endpoint'
    ? value
    : null
}

function readLogLevel(
  value: unknown,
): InstagramFeedSyncLogEntry['level'] | null {
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
