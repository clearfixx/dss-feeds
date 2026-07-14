import type { Payload, TaskConfig } from 'payload'

import {
  executeXFeedSync,
  type XFeedSyncExecutionReport,
} from '../orchestration.js'
import {
  createMemoryXFeedRunLock,
  type XFeedRunLock,
} from '../run-lock.js'
import type { XFeedHealthEvent, XFeedMonitorTrigger } from '../monitor.js'
import type { XFeedSource } from '../types.js'
import { createPayloadXFeedSnapshotStore } from './cache.js'
import { createPayloadXFeedMonitorStore } from './monitor-store.js'
import {
  createPayloadXFeedSource,
  readPayloadXFeedRuntimeSettings,
  type PayloadXFeedRuntimeSettings,
} from './runtime.js'

export const DEFAULT_X_FEED_TASK_SLUG = 'dss-x-feed-sync'
export const DEFAULT_X_FEED_QUEUE = 'dss-x-feed'
export const DEFAULT_X_FEED_SCHEDULE = '0 * * * *'

export interface PayloadXFeedHealthEventContext {
  payload: Payload
  settings: PayloadXFeedRuntimeSettings
}

export interface CreateXFeedSyncTaskOptions {
  taskSlug?: string
  queue?: string
  scheduleCron?: string
  scheduleEnabled?: boolean
  settingsSlug?: string
  cacheSlug?: string
  cacheKey?: string
  lockKey?: string
  xApiBearerTokenEnvironmentVariable?: string
  rssHubAuthorizationEnvironmentVariable?: string
  sourceFactory?: (
    settings: PayloadXFeedRuntimeSettings,
  ) => XFeedSource | Promise<XFeedSource>
  fetch?: typeof globalThis.fetch
  lock?: XFeedRunLock
  onHealthEvent?: (
    event: XFeedHealthEvent,
    context: PayloadXFeedHealthEventContext,
  ) => void | Promise<void>
  now?: () => Date
}

interface XFeedTaskInput {
  trigger?: XFeedMonitorTrigger
  force?: boolean
}

export function createXFeedSyncTask(
  options: CreateXFeedSyncTaskOptions = {},
): TaskConfig {
  const taskSlug = options.taskSlug ?? DEFAULT_X_FEED_TASK_SLUG
  const queue = options.queue ?? DEFAULT_X_FEED_QUEUE
  const scheduleCron = options.scheduleCron ?? DEFAULT_X_FEED_SCHEDULE
  const scheduleEnabled = options.scheduleEnabled ?? true
  const settingsSlug = options.settingsSlug ?? 'dss-x-feed-settings'
  const lock = options.lock ?? createMemoryXFeedRunLock()

  assertIdentifier(taskSlug, 'Task slug')
  assertIdentifier(queue, 'Queue name')
  assertCronExpression(scheduleCron)

  return {
    slug: taskSlug,
    label: 'Synchronize DSS X Feed',
    retries: 3,
    concurrency: {
      key: () => `dss-x-feed:${options.cacheKey ?? settingsSlug}`,
      exclusive: true,
      supersedes: false,
    },
    ...(scheduleEnabled
      ? { schedule: [{ cron: scheduleCron, queue }] }
      : {}),
    inputSchema: [
      {
        name: 'trigger',
        type: 'select',
        defaultValue: 'schedule',
        options: [
          { label: 'Schedule', value: 'schedule' },
          { label: 'Manual', value: 'manual' },
          { label: 'Endpoint', value: 'endpoint' },
        ],
      },
      { name: 'force', type: 'checkbox', defaultValue: false },
    ],
    outputSchema: [
      {
        name: 'status',
        type: 'select',
        required: true,
        options: [
          { label: 'Success', value: 'success' },
          { label: 'Skipped', value: 'skipped' },
        ],
      },
      {
        name: 'reason',
        type: 'select',
        options: [
          { label: 'Disabled', value: 'disabled' },
          { label: 'Not due', value: 'not_due' },
          { label: 'Locked', value: 'locked' },
        ],
      },
      { name: 'trigger', type: 'text', required: true },
      { name: 'cacheKey', type: 'text' },
      { name: 'created', type: 'checkbox' },
      { name: 'changed', type: 'checkbox' },
      { name: 'fetchedPostCount', type: 'number', required: true },
      { name: 'cachedPostCount', type: 'number', required: true },
      { name: 'checksum', type: 'text' },
      { name: 'generatedAt', type: 'date' },
      { name: 'freshUntil', type: 'date' },
      { name: 'staleUntil', type: 'date' },
      { name: 'nextSyncAt', type: 'date' },
      { name: 'selectedSourceId', type: 'text' },
      { name: 'monitorStatus', type: 'text' },
      {
        name: 'healthEvents',
        type: 'array',
        fields: [
          { name: 'type', type: 'text', required: true },
          { name: 'occurredAt', type: 'date', required: true },
        ],
      },
      {
        name: 'events',
        type: 'array',
        fields: [
          {
            name: 'level',
            type: 'select',
            required: true,
            options: [
              { label: 'Info', value: 'info' },
              { label: 'Success', value: 'success' },
              { label: 'Warning', value: 'warning' },
              { label: 'Error', value: 'error' },
            ],
          },
          { name: 'message', type: 'text', required: true },
          { name: 'timestamp', type: 'date', required: true },
          { name: 'context', type: 'json' },
        ],
      },
    ],
    handler: async ({ input, req }) => {
      const taskInput = (input ?? {}) as XFeedTaskInput
      const trigger = readTrigger(taskInput.trigger)
      const payload = req.payload
      const settings = await readPayloadXFeedRuntimeSettings({
        payload,
        settingsSlug,
      })

      if (!settings.enabled) {
        return {
          output: {
            status: 'skipped',
            reason: 'disabled',
            trigger,
            fetchedPostCount: 0,
            cachedPostCount: 0,
            healthEvents: [],
            events: [],
          },
        }
      }

      const source = options.sourceFactory
        ? await options.sourceFactory(settings)
        : await createPayloadXFeedSource({
            settings,
            ...(options.fetch ? { fetch: options.fetch } : {}),
            ...(options.xApiBearerTokenEnvironmentVariable
              ? {
                  xApiBearerTokenEnvironmentVariable:
                    options.xApiBearerTokenEnvironmentVariable,
                }
              : {}),
            ...(options.rssHubAuthorizationEnvironmentVariable
              ? {
                  rssHubAuthorizationEnvironmentVariable:
                    options.rssHubAuthorizationEnvironmentVariable,
                }
              : {}),
          })

      const report = await executeXFeedSync({
        source,
        snapshotStore: createPayloadXFeedSnapshotStore({
          payload,
          ...(options.cacheSlug
            ? { collectionSlug: options.cacheSlug }
            : {}),
        }),
        monitorStore: createPayloadXFeedMonitorStore({
          payload,
          settingsSlug,
        }),
        trigger,
        config: settings.config,
        policy: settings.cachePolicy,
        monitorPolicy: settings.monitorPolicy,
        force: taskInput.force === true,
        lock,
        ...(options.cacheKey ? { cacheKey: options.cacheKey } : {}),
        ...(options.lockKey ? { lockKey: options.lockKey } : {}),
        ...(options.now ? { now: options.now() } : {}),
        ...(options.onHealthEvent
          ? {
              onHealthEvent(event) {
                return options.onHealthEvent?.(event, {
                  payload,
                  settings,
                })
              },
            }
          : {}),
      })

      return { output: toTaskOutput(report) }
    },
  }
}

function toTaskOutput(
  report: XFeedSyncExecutionReport,
): Record<string, unknown> {
  return {
    status: report.status,
    ...(report.reason ? { reason: report.reason } : {}),
    trigger: report.trigger,
    cacheKey: report.cacheKey,
    created: report.created,
    changed: report.changed,
    fetchedPostCount: report.fetchedPostCount,
    cachedPostCount: report.cachedPostCount,
    ...(report.checksum ? { checksum: report.checksum } : {}),
    ...(report.generatedAt ? { generatedAt: report.generatedAt } : {}),
    ...(report.freshUntil ? { freshUntil: report.freshUntil } : {}),
    ...(report.staleUntil ? { staleUntil: report.staleUntil } : {}),
    ...(report.nextSyncAt ? { nextSyncAt: report.nextSyncAt } : {}),
    ...(report.selectedSourceId
      ? { selectedSourceId: report.selectedSourceId }
      : {}),
    ...(report.monitor
      ? { monitorStatus: report.monitor.status }
      : {}),
    healthEvents: report.healthEvents.map((event) => ({
      type: event.type,
      occurredAt: event.occurredAt,
    })),
    events: report.logs,
  }
}

function readTrigger(value: unknown): XFeedMonitorTrigger {
  return value === 'manual' || value === 'endpoint' || value === 'schedule'
    ? value
    : 'schedule'
}

function assertIdentifier(value: string, label: string): void {
  if (
    value.length === 0 ||
    value.length > 100 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  ) {
    throw new TypeError(
      `${label} must contain only letters, numbers, underscores, and hyphens.`,
    )
  }
}

function assertCronExpression(value: string): void {
  const fields = value.trim().split(/\s+/)
  if (fields.length !== 5 && fields.length !== 6) {
    throw new TypeError('Schedule cron must contain five or six fields.')
  }
}
