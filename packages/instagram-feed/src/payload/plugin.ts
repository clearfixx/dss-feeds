import type { CollectionConfig, Config, GlobalConfig, Plugin } from 'payload'
import type { InstagramMediaMirror } from '../types.js'
import { createInstagramFeedCache } from './cache.js'
import { createInstagramFeedSyncEndpoint } from './endpoint.js'
import { createInstagramFeedSettings } from './settings.js'
import {
  createInstagramFeedSyncTask,
  DEFAULT_INSTAGRAM_FEED_QUEUE,
  DEFAULT_INSTAGRAM_FEED_SCHEDULE,
  DEFAULT_INSTAGRAM_FEED_TASK_SLUG,
} from './task.js'

type PayloadEndpoint = NonNullable<Config['endpoints']>[number]

export interface InstagramFeedPluginOptions {
  disabled?: boolean
  adminGroup?: string
  settingsSlug?: string
  cacheSlug?: string
  cacheKey?: string
  taskSlug?: string
  queue?: string
  scheduleCron?: string
  syncEndpointPath?: string
  syncSecretEnvironmentVariable?: string
  monitorComponentPath?: string
  monitorJobLimit?: number
  officialAccessTokenEnvironmentVariable?: string
  officialUserIdEnvironmentVariable?: string
  experimentalSessionIdEnvironmentVariable?: string
  experimentalCsrfTokenEnvironmentVariable?: string
  experimentalDsUserIdEnvironmentVariable?: string
  experimentalAppIdEnvironmentVariable?: string
  experimentalUserAgentEnvironmentVariable?: string
  experimentalDocumentIdEnvironmentVariable?: string
  mediaMirror: InstagramMediaMirror
}

export const instagramFeedPlugin = (options: InstagramFeedPluginOptions): Plugin => (config: Config): Config => {
  if (!options || typeof options.mediaMirror !== 'function') {
    throw new Error('DSS Instagram Feed requires a mediaMirror function.')
  }

  const settingsSlug = options.settingsSlug ?? 'dss-instagram-feed-settings'
  const cacheSlug = options.cacheSlug ?? 'dss-instagram-feed-cache'
  const cacheKey = options.cacheKey ?? 'instagram:default'
  const taskSlug = options.taskSlug ?? DEFAULT_INSTAGRAM_FEED_TASK_SLUG
  const queue = options.queue ?? DEFAULT_INSTAGRAM_FEED_QUEUE
  const syncEndpointPath = options.syncEndpointPath ?? '/dss-instagram-feed/sync'
  const settings = createInstagramFeedSettings({
    slug: settingsSlug,
    adminGroup: options.adminGroup ?? 'DSS Feeds',
    monitor: {
      componentPath: options.monitorComponentPath,
      cacheSlug,
      cacheKey,
      taskSlug,
      syncEndpointPath,
      jobLimit: options.monitorJobLimit,
    },
  })
  const cache = createInstagramFeedCache({ slug: cacheSlug })
  const task = createInstagramFeedSyncTask({
    taskSlug,
    queue,
    scheduleCron: options.scheduleCron ?? DEFAULT_INSTAGRAM_FEED_SCHEDULE,
    scheduleEnabled: options.disabled !== true,
    settingsSlug,
    cacheSlug,
    cacheKey,
    officialAccessTokenEnvironmentVariable: options.officialAccessTokenEnvironmentVariable,
    officialUserIdEnvironmentVariable: options.officialUserIdEnvironmentVariable,
    experimentalSessionIdEnvironmentVariable: options.experimentalSessionIdEnvironmentVariable,
    experimentalCsrfTokenEnvironmentVariable: options.experimentalCsrfTokenEnvironmentVariable,
    experimentalDsUserIdEnvironmentVariable: options.experimentalDsUserIdEnvironmentVariable,
    experimentalAppIdEnvironmentVariable: options.experimentalAppIdEnvironmentVariable,
    experimentalUserAgentEnvironmentVariable: options.experimentalUserAgentEnvironmentVariable,
    experimentalDocumentIdEnvironmentVariable: options.experimentalDocumentIdEnvironmentVariable,
    mediaMirror: options.mediaMirror,
  })
  const endpoint = createInstagramFeedSyncEndpoint({
    path: syncEndpointPath,
    taskSlug,
    queue,
    syncSecretEnvironmentVariable: options.syncSecretEnvironmentVariable,
  })

  assertSlugAvailable(config.globals ?? [], settings.slug, 'global')
  assertSlugAvailable(config.collections ?? [], cache.slug, 'collection')
  assertJobSlugAvailable(config.jobs?.tasks ?? [], config.jobs?.workflows ?? [], task.slug)
  assertEndpointAvailable(config.endpoints ?? [], endpoint)

  return {
    ...config,
    globals: [...(config.globals ?? []), settings],
    collections: [...(config.collections ?? []), cache],
    endpoints: [...(config.endpoints ?? []), endpoint],
    jobs: {
      ...config.jobs,
      enableConcurrencyControl: true,
      tasks: [...(config.jobs?.tasks ?? []), task],
    },
  }
}

function assertSlugAvailable(entries: readonly (CollectionConfig | GlobalConfig)[], slug: string, kind: 'collection' | 'global'): void {
  if (entries.some((entry) => entry.slug === slug)) throw new Error(`DSS Instagram Feed cannot register ${kind} "${slug}" because that slug already exists.`)
}
function assertJobSlugAvailable(tasks: readonly { slug: string }[], workflows: readonly { slug: string }[], slug: string): void {
  if (tasks.some((task) => task.slug === slug) || workflows.some((workflow) => workflow.slug === slug)) {
    throw new Error(`DSS Instagram Feed cannot register task "${slug}" because that job slug already exists.`)
  }
}
function assertEndpointAvailable(endpoints: readonly PayloadEndpoint[], candidate: PayloadEndpoint): void {
  if (endpoints.some((endpoint) => endpoint.path === candidate.path && endpoint.method === candidate.method)) {
    throw new Error(`DSS Instagram Feed cannot register ${candidate.method.toUpperCase()} endpoint "${candidate.path}" because that route already exists.`)
  }
}
