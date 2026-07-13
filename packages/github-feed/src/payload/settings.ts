import type {
  GlobalConfig,
} from 'payload'

import {
  isAuthenticatedPayloadRequest,
} from './access.js'

export interface GitHubFeedMonitorFieldOptions {
  componentPath?: string
  cacheSlug: string
  cacheKey: string
  taskSlug: string
  syncEndpointPath: string
  jobLimit?: number
}

export interface CreateGitHubFeedSettingsOptions {
  slug: string
  adminGroup: string
  monitor: GitHubFeedMonitorFieldOptions
}

export function createGitHubFeedSettings(
  options: CreateGitHubFeedSettingsOptions,
): GlobalConfig {
  return {
    slug: options.slug,
    label: 'GitHub Feed Settings',
    admin: {
      group: options.adminGroup,
    },
    access: {
      read:
        isAuthenticatedPayloadRequest,
      update:
        isAuthenticatedPayloadRequest,
    },
    fields: [
      {
        name: 'enabled',
        type: 'checkbox',
        defaultValue: false,
        label:
          'Enable GitHub feed synchronization',
      },
      {
        name: 'username',
        type: 'text',
        label: 'GitHub username',
        admin: {
          description:
            'Used to filter commits and as the default repository owner.',
          placeholder: 'clearfixx',
        },
      },
      {
        name: 'repositories',
        type: 'array',
        label: 'Repositories',
        minRows: 1,
        maxRows: 20,
        admin: {
          description:
            'Use owner/name or a bare repository name when the owner matches the configured username.',
          initCollapsed: true,
        },
        fields: [
          {
            name: 'repository',
            type: 'text',
            required: true,
            admin: {
              placeholder:
                'clearfixx/portfolio',
            },
          },
        ],
      },
      {
        name: 'commitLimit',
        type: 'number',
        defaultValue: 10,
        min: 1,
        max: 100,
        required: true,
        label: 'Cached commit limit',
        admin: {
          description:
            'Maximum number of normalized commits retained in the active snapshot.',
          step: 1,
        },
      },
      {
        name: 'syncIntervalHours',
        type: 'number',
        defaultValue: 1,
        min: 1,
        max: 24,
        required: true,
        label:
          'Synchronization interval',
        admin: {
          description:
            'The scheduled task checks this value before contacting GitHub.',
          step: 1,
        },
      },
      {
        name: 'freshForMinutes',
        type: 'number',
        defaultValue: 90,
        min: 15,
        max: 1440,
        required: true,
        label:
          'Fresh cache lifetime',
        admin: {
          description:
            'A successful snapshot is considered fresh for this many minutes.',
          step: 1,
        },
      },
      {
        name: 'staleForHours',
        type: 'number',
        defaultValue: 24,
        min: 1,
        max: 168,
        required: true,
        label:
          'Stale fallback lifetime',
        admin: {
          description:
            'The last successful snapshot remains renderable for this many additional hours after freshness expires.',
          step: 1,
        },
      },
      {
        name: 'monitor',
        type: 'ui',
        label:
          'GitHub Feed Monitor',
        admin: {
          disableListColumn: true,
          components: {
            Field: {
              path:
                options.monitor
                  .componentPath ??
                '@dss-feeds/github-feed/admin',
              exportName:
                'GitHubFeedMonitor',
              serverProps: {
                cacheSlug:
                  options.monitor
                    .cacheSlug,
                cacheKey:
                  options.monitor
                    .cacheKey,
                taskSlug:
                  options.monitor
                    .taskSlug,
                syncEndpointPath:
                  options.monitor
                    .syncEndpointPath,
                jobLimit:
                  options.monitor
                    .jobLimit ?? 5,
              },
            },
          },
        },
      },
    ],
  }
}
