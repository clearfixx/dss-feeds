import type {
  Config,
  TaskConfig,
} from 'payload'
import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  createGitHubFeedSyncTask,
  githubFeedPlugin,
} from '../src/payload/index.js'

describe(
  'createGitHubFeedSyncTask',
  () => {
    it(
      'uses safe queue, retry, schedule, and concurrency defaults',
      () => {
        const task =
          createGitHubFeedSyncTask()

        expect(task.slug).toBe(
          'dss-github-feed-sync',
        )
        expect(task.retries).toBe(3)
        expect(task.schedule).toEqual([
          {
            cron: '0 * * * *',
            queue:
              'dss-github-feed',
          },
        ])

        if (
          !task.concurrency ||
          typeof task.concurrency ===
            'function'
        ) {
          throw new Error(
            'Expected full concurrency configuration.',
          )
        }

        expect(
          task.concurrency,
        ).toMatchObject({
          exclusive: true,
          supersedes: true,
        })

        const key =
          task.concurrency.key as (
            args: {
              input: unknown
              queue: string
            },
          ) => string

        expect(
          key({
            input: {},
            queue:
              'dss-github-feed',
          }),
        ).toBe(
          'dss-github-feed:github:default',
        )
      },
    )

    it(
      'keeps the task available without a recurring schedule',
      () => {
        const task =
          createGitHubFeedSyncTask({
            scheduleEnabled: false,
          })

        expect(
          task.schedule,
        ).toBeUndefined()
        expect(
          typeof task.handler,
        ).toBe('function')
      },
    )

    it(
      'rejects malformed task and cron configuration',
      () => {
        expect(() =>
          createGitHubFeedSyncTask({
            taskSlug: '../unsafe',
          }),
        ).toThrow(
          'Task slug must contain only',
        )

        expect(() =>
          createGitHubFeedSyncTask({
            scheduleCron:
              'invalid',
          }),
        ).toThrow(
          'Schedule cron must contain five or six fields',
        )
      },
    )
  },
)

describe(
  'githubFeedPlugin job registration',
  () => {
    const existingTask: TaskConfig = {
      slug: 'existing-task',
      handler: async () => ({
        output: {},
      }),
    }

    const baseConfig = {
      secret: 'test-secret',
      collections: [],
      globals: [],
      jobs: {
        tasks: [existingTask],
      },
    } as unknown as Config

    it(
      'preserves existing jobs and enables concurrency control',
      async () => {
        const result =
          await githubFeedPlugin()(
            baseConfig,
          )

        expect(
          result.jobs
            ?.enableConcurrencyControl,
        ).toBe(true)
        expect(
          result.jobs?.tasks?.map(
            (task) => task.slug,
          ),
        ).toEqual([
          'existing-task',
          'dss-github-feed-sync',
        ])
      },
    )

    it(
      'disables only the recurring schedule when the plugin is disabled',
      async () => {
        const result =
          await githubFeedPlugin({
            disabled: true,
          })(baseConfig)
        const task =
          result.jobs?.tasks?.find(
            (entry) =>
              entry.slug ===
              'dss-github-feed-sync',
          )

        expect(task).toBeDefined()
        expect(
          task?.schedule,
        ).toBeUndefined()
      },
    )

    it(
      'fails early when another task already owns the slug',
      () => {
        const collisionConfig = {
          ...baseConfig,
          jobs: {
            tasks: [
              ...(baseConfig.jobs
                ?.tasks ?? []),
              {
                slug:
                  'dss-github-feed-sync',
                handler:
                  async () => ({
                    output: {},
                  }),
              },
            ],
          },
        } as unknown as Config

        expect(() =>
          githubFeedPlugin()(
            collisionConfig,
          ),
        ).toThrow(
          'DSS GitHub Feed cannot register task "dss-github-feed-sync"',
        )
      },
    )
  },
)
