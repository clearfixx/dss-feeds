import type {
  CollectionConfig,
  Config,
  GlobalConfig,
  Plugin,
} from 'payload'

import { createGitHubFeedCache } from './cache.js'
import { createGitHubFeedSettings } from './settings.js'

export interface GitHubFeedPluginOptions {
  /**
   * Keep the schema registered while disabling runtime features that are
   * introduced in later slices.
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
}

const DEFAULT_SETTINGS_SLUG = 'dss-github-feed-settings'
const DEFAULT_CACHE_SLUG = 'dss-github-feed-cache'
const DEFAULT_ADMIN_GROUP = 'DSS Feeds'

export const githubFeedPlugin =
  (options: GitHubFeedPluginOptions = {}): Plugin =>
  (config: Config): Config => {
    const settings = createGitHubFeedSettings({
      slug: options.settingsSlug ?? DEFAULT_SETTINGS_SLUG,
      adminGroup: options.adminGroup ?? DEFAULT_ADMIN_GROUP,
    })
    const cache = createGitHubFeedCache({
      slug: options.cacheSlug ?? DEFAULT_CACHE_SLUG,
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

    return {
      ...config,
      globals: [...(config.globals ?? []), settings],
      collections: [...(config.collections ?? []), cache],
    }
  }

function assertSlugAvailable(
  entries: readonly (CollectionConfig | GlobalConfig)[],
  slug: string,
  kind: 'collection' | 'global',
): void {
  if (entries.some((entry) => entry.slug === slug)) {
    throw new Error(
      `DSS GitHub Feed cannot register ${kind} "${slug}" because that slug already exists.`,
    )
  }
}
