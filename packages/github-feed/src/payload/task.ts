import type { TaskConfig } from 'payload'

import {
  synchronizeGitHubFeed,
  type GitHubFeedSyncLogEntry,
} from './sync.js'

export const DEFAULT_GITHUB_FEED_TASK_SLUG =
  'dss-github-feed-sync'
export const DEFAULT_GITHUB_FEED_QUEUE =
  'dss-github-feed'
export const DEFAULT_GITHUB_FEED_SCHEDULE =
  '0 * * * *'

export interface CreateGitHubFeedSyncTaskOptions {
  taskSlug?: string
  queue?: string
  scheduleCron?: string
  scheduleEnabled?: boolean
  tokenEnvironmentVariable?: string
  settingsSlug?: string
  cacheSlug?: string
  cacheKey?: string

  /**
   * Internal test seam. Production integrations should use the native
   * Fetch API.
   */
  fetch?: typeof globalThis.fetch

  /**
   * Internal test seam for deterministic task timestamps.
   */
  now?: () => Date
}

interface GitHubFeedTaskInput {
  trigger?: 'schedule' | 'manual' | 'endpoint'
  force?: boolean
}

export function createGitHubFeedSyncTask(
  options: CreateGitHubFeedSyncTaskOptions = {},
): TaskConfig {
  const taskSlug =
    options.taskSlug ??
    DEFAULT_GITHUB_FEED_TASK_SLUG
  const queue =
    options.queue ?? DEFAULT_GITHUB_FEED_QUEUE
  const scheduleCron =
    options.scheduleCron ??
    DEFAULT_GITHUB_FEED_SCHEDULE
  const scheduleEnabled =
    options.scheduleEnabled ?? true
  const tokenEnvironmentVariable =
    options.tokenEnvironmentVariable ??
    'DSS_GITHUB_TOKEN'

  assertTaskIdentifier(taskSlug, 'Task slug')
  assertTaskIdentifier(queue, 'Queue name')
  assertCronExpression(scheduleCron)

  return {
    slug: taskSlug,
    label: 'Synchronize DSS GitHub Feed',
    retries: 3,
    concurrency: {
      key: () =>
        `dss-github-feed:${
          options.cacheKey ?? 'github:default'
        }`,
      exclusive: true,
      supersedes: true,
    },
    ...(scheduleEnabled
      ? {
          schedule: [
            {
              cron: scheduleCron,
              queue,
            },
          ],
        }
      : {}),
    inputSchema: [
      {
        name: 'trigger',
        type: 'select',
        defaultValue: 'schedule',
        options: [
          {
            label: 'Schedule',
            value: 'schedule',
          },
          {
            label: 'Manual',
            value: 'manual',
          },
          {
            label: 'Endpoint',
            value: 'endpoint',
          },
        ],
      },
      {
        name: 'force',
        type: 'checkbox',
        defaultValue: false,
      },
    ],
    outputSchema: [
      {
        name: 'status',
        type: 'select',
        required: true,
        options: [
          {
            label: 'Success',
            value: 'success',
          },
          {
            label: 'Skipped',
            value: 'skipped',
          },
        ],
      },
      {
        name: 'reason',
        type: 'select',
        options: [
          {
            label: 'Disabled',
            value: 'disabled',
          },
          {
            label: 'Not due',
            value: 'not_due',
          },
        ],
      },
      {
        name: 'created',
        type: 'checkbox',
      },
      {
        name: 'changed',
        type: 'checkbox',
      },
      {
        name: 'commitCount',
        type: 'number',
        required: true,
      },
      {
        name: 'checksum',
        type: 'text',
      },
      {
        name: 'generatedAt',
        type: 'date',
      },
      {
        name: 'freshUntil',
        type: 'date',
      },
      {
        name: 'staleUntil',
        type: 'date',
      },
      {
        name: 'nextSyncAt',
        type: 'date',
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
              {
                label: 'Info',
                value: 'info',
              },
              {
                label: 'Success',
                value: 'success',
              },
              {
                label: 'Warning',
                value: 'warning',
              },
              {
                label: 'Error',
                value: 'error',
              },
            ],
          },
          {
            name: 'message',
            type: 'text',
            required: true,
          },
          {
            name: 'timestamp',
            type: 'date',
            required: true,
          },
          {
            name: 'context',
            type: 'json',
          },
        ],
      },
    ],
    handler: async ({ input, req }) => {
      const taskInput =
        (input ?? {}) as GitHubFeedTaskInput
      const events: GitHubFeedSyncLogEntry[] = []
      const trigger =
        taskInput.trigger ?? 'schedule'
      const force = taskInput.force === true
      const now = options.now?.() ?? new Date()

      const result = await synchronizeGitHubFeed({
        payload: req.payload,
        token:
          process.env[
            tokenEnvironmentVariable
          ],
        fetch: options.fetch,
        now,
        force,
        settingsSlug: options.settingsSlug,
        cacheSlug: options.cacheSlug,
        cacheKey: options.cacheKey,
        onLog(entry) {
          events.push(entry)
        },
      })

      return {
        output: {
          status: result.status,
          ...(result.reason
            ? { reason: result.reason }
            : {}),
          created: result.created,
          changed: result.changed,
          commitCount: result.commitCount,
          ...(result.checksum
            ? { checksum: result.checksum }
            : {}),
          ...(result.generatedAt
            ? {
                generatedAt:
                  result.generatedAt,
              }
            : {}),
          ...(result.freshUntil
            ? {
                freshUntil:
                  result.freshUntil,
              }
            : {}),
          ...(result.staleUntil
            ? {
                staleUntil:
                  result.staleUntil,
              }
            : {}),
          ...(result.nextSyncAt
            ? {
                nextSyncAt:
                  result.nextSyncAt,
              }
            : {}),
          events: [
            {
              level: 'info',
              message:
                `Synchronization trigger: ${trigger}.`,
              timestamp: now.toISOString(),
            },
            ...events,
          ],
        },
      }
    },
  }
}

function assertTaskIdentifier(
  value: string,
  label: string,
): void {
  if (
    value.length === 0 ||
    value.length > 100 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(
      value,
    )
  ) {
    throw new TypeError(
      `${label} must contain only letters, numbers, underscores, and hyphens.`,
    )
  }
}

function assertCronExpression(
  value: string,
): void {
  const fields = value.trim().split(/\s+/)

  if (
    fields.length !== 5 &&
    fields.length !== 6
  ) {
    throw new TypeError(
      'Schedule cron must contain five or six fields.',
    )
  }
}
