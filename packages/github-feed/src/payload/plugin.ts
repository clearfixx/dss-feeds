import type {
  CollectionConfig,
  Config,
  GlobalConfig,
  Plugin,
} from 'payload'

import { createGitHubFeedCache } from './cache.js'
import { createGitHubFeedSettings } from './settings.js'
import {
  createGitHubFeedSyncTask,
  DEFAULT_GITHUB_FEED_QUEUE,
  DEFAULT_GITHUB_FEED_SCHEDULE,
  DEFAULT_GITHUB_FEED_TASK_SLUG,
} from './task.js'

export interface GitHubFeedPluginOptions {
  /**
   * Keep schemas and the task registered while disabling its recurring
   * schedule. Manual jobs can still be queued.
   */
  disabled?: boolean

  /**
   * Payload navigation group used for the settings global.
   */
  adminGroup?: string

  /**
   * Slug of the singleton settings global.
   */
  settingsSlug?: string

  /**
   * Slug of the internal snapshot collection.
   */
  cacheSlug?: string

  /**
   * Unique key of the active snapshot document.
   */
  cacheKey?: string

  /**
   * Payload task slug.
   */
  taskSlug?: string

  /**
   * Payload queue used by scheduled and manually queued jobs.
   */
  queue?: string

  /**
   * Cron expression used to queue periodic checks.
   */
  scheduleCron?: string

  /**
   * Server environment variable containing an optional GitHub token.
   */
  tokenEnvironmentVariable?: string
}

const DEFAULT_SETTINGS_SLUG =
  'dss-github-feed-settings'
const DEFAULT_CACHE_SLUG =
  'dss-github-feed-cache'
const DEFAULT_ADMIN_GROUP = 'DSS Feeds'

export const githubFeedPlugin =
  (
    options: GitHubFeedPluginOptions = {},
  ): Plugin =>
  (config: Config): Config => {
    const settingsSlug =
      options.settingsSlug ??
      DEFAULT_SETTINGS_SLUG
    const cacheSlug =
      options.cacheSlug ?? DEFAULT_CACHE_SLUG
    const taskSlug =
      options.taskSlug ??
      DEFAULT_GITHUB_FEED_TASK_SLUG

    const settings =
      createGitHubFeedSettings({
        slug: settingsSlug,
        adminGroup:
          options.adminGroup ??
          DEFAULT_ADMIN_GROUP,
      })
    const cache = createGitHubFeedCache({
      slug: cacheSlug,
    })
    const task = createGitHubFeedSyncTask({
      taskSlug,
      queue:
        options.queue ??
        DEFAULT_GITHUB_FEED_QUEUE,
      scheduleCron:
        options.scheduleCron ??
        DEFAULT_GITHUB_FEED_SCHEDULE,
      scheduleEnabled:
        options.disabled !== true,
      tokenEnvironmentVariable:
        options.tokenEnvironmentVariable,
      settingsSlug,
      cacheSlug,
      cacheKey: options.cacheKey,
    })

    assertSlugAvailable(
      config.globals ?? [],
      settings.slug,
      'global',
    )
    assertSlugAvailable(
      config.collections ?? [],
      cache.slug,
      'collection',
    )
    assertJobSlugAvailable(
      config.jobs?.tasks ?? [],
      config.jobs?.workflows ?? [],
      task.slug,
    )

    return {
      ...config,
      globals: [
        ...(config.globals ?? []),
        settings,
      ],
      collections: [
        ...(config.collections ?? []),
        cache,
      ],
      jobs: {
        ...config.jobs,
        enableConcurrencyControl: true,
        tasks: [
          ...(config.jobs?.tasks ?? []),
          task,
        ],
      },
    }
  }

function assertSlugAvailable(
  entries: readonly (
    | CollectionConfig
    | GlobalConfig
  )[],
  slug: string,
  kind: 'collection' | 'global',
): void {
  if (
    entries.some(
      (entry) => entry.slug === slug,
    )
  ) {
    throw new Error(
      `DSS GitHub Feed cannot register ${kind} "${slug}" because that slug already exists.`,
    )
  }
}

function assertJobSlugAvailable(
  tasks: readonly { slug: string }[],
  workflows: readonly { slug: string }[],
  slug: string,
): void {
  if (
    tasks.some(
      (task) => task.slug === slug,
    ) ||
    workflows.some(
      (workflow) =>
        workflow.slug === slug,
    )
  ) {
    throw new Error(
      `DSS GitHub Feed cannot register task "${slug}" because that job slug already exists.`,
    )
  }
}
