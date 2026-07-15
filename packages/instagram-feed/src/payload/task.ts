import type { TaskConfig } from 'payload'
import { beginInstagramFeedRun, completeInstagramFeedRun, failInstagramFeedRun } from './state.js'
import { synchronizeInstagramFeed, type InstagramFeedSyncLogEntry } from './sync.js'
import type { InstagramMediaMirror } from '../types.js'

export const DEFAULT_INSTAGRAM_FEED_TASK_SLUG = 'dss-instagram-feed-sync'
export const DEFAULT_INSTAGRAM_FEED_QUEUE = 'dss-instagram-feed'
export const DEFAULT_INSTAGRAM_FEED_SCHEDULE = '0 * * * *'

export interface CreateInstagramFeedSyncTaskOptions {
  taskSlug?: string
  queue?: string
  scheduleCron?: string
  scheduleEnabled?: boolean
  settingsSlug?: string
  cacheSlug?: string
  cacheKey?: string
  officialAccessTokenEnvironmentVariable?: string
  officialUserIdEnvironmentVariable?: string
  experimentalSessionIdEnvironmentVariable?: string
  experimentalCsrfTokenEnvironmentVariable?: string
  experimentalDsUserIdEnvironmentVariable?: string
  experimentalAppIdEnvironmentVariable?: string
  experimentalUserAgentEnvironmentVariable?: string
  experimentalDocumentIdEnvironmentVariable?: string
  mediaMirror?: InstagramMediaMirror
  fetch?: typeof globalThis.fetch
  now?: () => Date
}

interface TaskInput { trigger?: 'schedule' | 'manual' | 'endpoint'; force?: boolean }

export function createInstagramFeedSyncTask(options: CreateInstagramFeedSyncTaskOptions = {}): TaskConfig {
  const taskSlug = options.taskSlug ?? DEFAULT_INSTAGRAM_FEED_TASK_SLUG
  const queue = options.queue ?? DEFAULT_INSTAGRAM_FEED_QUEUE
  const scheduleCron = options.scheduleCron ?? DEFAULT_INSTAGRAM_FEED_SCHEDULE
  const scheduleEnabled = options.scheduleEnabled ?? true
  assertIdentifier(taskSlug, 'Task slug')
  assertIdentifier(queue, 'Queue name')
  assertCron(scheduleCron)

  return {
    slug: taskSlug,
    label: 'Synchronize DSS Instagram Feed',
    retries: 3,
    concurrency: {
      key: () => `dss-instagram-feed:${options.cacheKey ?? 'instagram:default'}`,
      exclusive: true,
      supersedes: false,
    },
    ...(scheduleEnabled ? { schedule: [{ cron: scheduleCron, queue }] } : {}),
    inputSchema: [
      {
        name: 'trigger', type: 'select', defaultValue: 'schedule',
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
        name: 'status', type: 'select', required: true,
        options: [{ label: 'Success', value: 'success' }, { label: 'Skipped', value: 'skipped' }],
      },
      {
        name: 'reason', type: 'select',
        options: [{ label: 'Disabled', value: 'disabled' }, { label: 'Not due', value: 'not_due' }],
      },
      { name: 'created', type: 'checkbox' },
      { name: 'changed', type: 'checkbox' },
      { name: 'postCount', type: 'number', required: true },
      { name: 'checksum', type: 'text' },
      { name: 'generatedAt', type: 'date' },
      { name: 'freshUntil', type: 'date' },
      { name: 'staleUntil', type: 'date' },
      { name: 'nextSyncAt', type: 'date' },
      {
        name: 'events', type: 'array',
        fields: [
          {
            name: 'level', type: 'select', required: true,
            options: [
              { label: 'Info', value: 'info' }, { label: 'Success', value: 'success' },
              { label: 'Warning', value: 'warning' }, { label: 'Error', value: 'error' },
            ],
          },
          { name: 'message', type: 'text', required: true },
          { name: 'timestamp', type: 'date', required: true },
          { name: 'context', type: 'json' },
        ],
      },
    ],
    handler: async ({ input, req }) => {
      const taskInput = (input ?? {}) as TaskInput
      const trigger = taskInput.trigger ?? 'schedule'
      const force = taskInput.force === true
      const startedAt = options.now?.() ?? new Date()
      const events: InstagramFeedSyncLogEntry[] = []
      const context = await beginInstagramFeedRun({
        payload: req.payload,
        settingsSlug: options.settingsSlug,
        trigger,
        now: startedAt,
      })

      try {
        const result = await synchronizeInstagramFeed({
          payload: req.payload,
          officialAccessToken: process.env[options.officialAccessTokenEnvironmentVariable ?? 'DSS_INSTAGRAM_ACCESS_TOKEN'],
          officialUserId: process.env[options.officialUserIdEnvironmentVariable ?? 'DSS_INSTAGRAM_USER_ID'],
          experimentalSessionId: process.env[options.experimentalSessionIdEnvironmentVariable ?? 'DSS_INSTAGRAM_SESSION_ID'],
          experimentalCsrfToken: process.env[options.experimentalCsrfTokenEnvironmentVariable ?? 'DSS_INSTAGRAM_CSRF_TOKEN'],
          experimentalDsUserId: process.env[options.experimentalDsUserIdEnvironmentVariable ?? 'DSS_INSTAGRAM_DS_USER_ID'],
          experimentalAppId: process.env[options.experimentalAppIdEnvironmentVariable ?? 'DSS_INSTAGRAM_APP_ID'],
          experimentalUserAgent: process.env[options.experimentalUserAgentEnvironmentVariable ?? 'DSS_INSTAGRAM_USER_AGENT'],
          experimentalDocumentId: process.env[options.experimentalDocumentIdEnvironmentVariable ?? 'DSS_INSTAGRAM_GRAPHQL_DOC_ID'],
          mediaMirror: options.mediaMirror,
          fetch: options.fetch,
          now: startedAt,
          force,
          settingsSlug: options.settingsSlug,
          cacheSlug: options.cacheSlug,
          cacheKey: options.cacheKey,
          onLog(entry) { events.push(entry) },
        })
        const completedAt = options.now?.() ?? new Date()
        await completeInstagramFeedRun({
          payload: req.payload,
          settingsSlug: options.settingsSlug,
          context,
          result,
          events,
          completedAt,
        })

        return {
          output: {
            status: result.status,
            ...(result.reason ? { reason: result.reason } : {}),
            created: result.created,
            changed: result.changed,
            postCount: result.postCount,
            ...(result.checksum ? { checksum: result.checksum } : {}),
            ...(result.generatedAt ? { generatedAt: result.generatedAt } : {}),
            ...(result.freshUntil ? { freshUntil: result.freshUntil } : {}),
            ...(result.staleUntil ? { staleUntil: result.staleUntil } : {}),
            ...(result.nextSyncAt ? { nextSyncAt: result.nextSyncAt } : {}),
            events,
          },
        }
      } catch (error) {
        const completedAt = options.now?.() ?? new Date()
        await failInstagramFeedRun({
          payload: req.payload,
          settingsSlug: options.settingsSlug,
          context,
          events,
          completedAt,
          error,
        })
        throw error
      }
    },
  }
}

function assertIdentifier(value: string, label: string): void {
  if (value.length === 0 || value.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new TypeError(`${label} must contain only letters, numbers, underscores, and hyphens.`)
  }
}
function assertCron(value: string): void {
  const fields = value.trim().split(/\s+/)
  if (fields.length !== 5 && fields.length !== 6) throw new TypeError('Schedule cron must contain five or six fields.')
}
