import type {
  CollectionConfig,
  Config,
  GlobalConfig,
  Plugin,
} from 'payload'

import {
  createGitHubFeedCache,
} from './cache.js'
import {
  createGitHubFeedSyncEndpoint,
} from './endpoint.js'
import {
  createGitHubFeedSettings,
} from './settings.js'
import {
  createGitHubFeedSyncTask,
  DEFAULT_GITHUB_FEED_QUEUE,
  DEFAULT_GITHUB_FEED_SCHEDULE,
  DEFAULT_GITHUB_FEED_TASK_SLUG,
} from './task.js'

type PayloadEndpoint =
  NonNullable<Config['endpoints']>[number]

export interface GitHubFeedPluginOptions {
  disabled?: boolean
  adminGroup?: string
  settingsSlug?: string
  cacheSlug?: string
  cacheKey?: string
  taskSlug?: string
  queue?: string
  scheduleCron?: string
  tokenEnvironmentVariable?: string
  syncEndpointPath?: string
  syncSecretEnvironmentVariable?: string

  /**
   * Optional custom component path for advanced package embedding.
   */
  monitorComponentPath?: string

  /**
   * Number of recent Payload jobs shown in the admin monitor.
   */
  monitorJobLimit?: number
}

const DEFAULT_SETTINGS_SLUG =
  'dss-github-feed-settings'
const DEFAULT_CACHE_SLUG =
  'dss-github-feed-cache'
const DEFAULT_CACHE_KEY =
  'github:default'
const DEFAULT_ADMIN_GROUP =
  'DSS Feeds'
const DEFAULT_SYNC_ENDPOINT_PATH =
  '/dss-github-feed/sync'

export const githubFeedPlugin =
  (
    options: GitHubFeedPluginOptions = {},
  ): Plugin =>
  (config: Config): Config => {
    const settingsSlug =
      options.settingsSlug ??
      DEFAULT_SETTINGS_SLUG
    const cacheSlug =
      options.cacheSlug ??
      DEFAULT_CACHE_SLUG
    const cacheKey =
      options.cacheKey ??
      DEFAULT_CACHE_KEY
    const taskSlug =
      options.taskSlug ??
      DEFAULT_GITHUB_FEED_TASK_SLUG
    const queue =
      options.queue ??
      DEFAULT_GITHUB_FEED_QUEUE
    const syncEndpointPath =
      options.syncEndpointPath ??
      DEFAULT_SYNC_ENDPOINT_PATH

    const settings =
      createGitHubFeedSettings({
        slug: settingsSlug,
        adminGroup:
          options.adminGroup ??
          DEFAULT_ADMIN_GROUP,
        monitor: {
          componentPath:
            options.monitorComponentPath,
          cacheSlug,
          cacheKey,
          taskSlug,
          syncEndpointPath,
          jobLimit:
            options.monitorJobLimit,
        },
      })
    const cache =
      createGitHubFeedCache({
        slug: cacheSlug,
      })
    const task =
      createGitHubFeedSyncTask({
        taskSlug,
        queue,
        scheduleCron:
          options.scheduleCron ??
          DEFAULT_GITHUB_FEED_SCHEDULE,
        scheduleEnabled:
          options.disabled !== true,
        tokenEnvironmentVariable:
          options
            .tokenEnvironmentVariable,
        settingsSlug,
        cacheSlug,
        cacheKey,
      })
    const endpoint =
      createGitHubFeedSyncEndpoint({
        path: syncEndpointPath,
        taskSlug,
        queue,
        syncSecretEnvironmentVariable:
          options
            .syncSecretEnvironmentVariable,
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
    assertEndpointAvailable(
      config.endpoints ?? [],
      endpoint,
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
      endpoints: [
        ...(config.endpoints ?? []),
        endpoint,
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
  kind:
    | 'collection'
    | 'global',
): void {
  if (
    entries.some(
      (entry) =>
        entry.slug === slug,
    )
  ) {
    throw new Error(
      `DSS GitHub Feed cannot register ${kind} "${slug}" because that slug already exists.`,
    )
  }
}

function assertJobSlugAvailable(
  tasks: readonly {
    slug: string
  }[],
  workflows: readonly {
    slug: string
  }[],
  slug: string,
): void {
  if (
    tasks.some(
      (task) =>
        task.slug === slug,
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

function assertEndpointAvailable(
  endpoints:
    readonly PayloadEndpoint[],
  candidate: PayloadEndpoint,
): void {
  if (
    endpoints.some(
      (endpoint) =>
        endpoint.path ===
          candidate.path &&
        endpoint.method ===
          candidate.method,
    )
  ) {
    throw new Error(
      `DSS GitHub Feed cannot register ${candidate.method.toUpperCase()} endpoint "${candidate.path}" because that route already exists.`,
    )
  }
}
