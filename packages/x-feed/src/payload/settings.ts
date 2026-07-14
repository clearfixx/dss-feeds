import type { Field, GlobalConfig } from 'payload'

export interface XFeedMonitorFieldOptions {
  componentPath?: string
  cacheSlug?: string
  cacheKey?: string
  statusEndpointPath?: string
  syncEndpointPath?: string
  pollIntervalMs?: number
  title?: string
}

export interface CreateXFeedSettingsOptions {
  slug?: string
  adminGroup?: string
  monitor?: XFeedMonitorFieldOptions
}

const DEFAULT_SETTINGS_SLUG = 'dss-x-feed-settings'
const DEFAULT_ADMIN_GROUP = 'DSS Feeds'

export function createXFeedSettingsGlobal(
  options: CreateXFeedSettingsOptions = {},
): GlobalConfig {
  const slug = options.slug ?? DEFAULT_SETTINGS_SLUG
  return {
    slug,
    label: 'X Feed Settings',
    admin: { group: options.adminGroup ?? DEFAULT_ADMIN_GROUP },
    access: { read: isAuthenticated, update: isAuthenticated },
    fields: [
      {
        name: 'enabled',
        type: 'checkbox',
        defaultValue: false,
        label: 'Enable X feed synchronization',
      },
      {
        name: 'username',
        type: 'text',
        label: 'X username',
        admin: { placeholder: 'username' },
      },
      {
        name: 'sourceMode',
        type: 'select',
        defaultValue: 'official-api',
        required: true,
        options: [
          { label: 'Official X API', value: 'official-api' },
          { label: 'Nitter-compatible RSS (experimental)', value: 'nitter' },
          { label: 'RSSHub (experimental)', value: 'rsshub' },
          { label: 'Fallback chain', value: 'fallback' },
          { label: 'Custom source', value: 'custom' },
        ],
        admin: {
          description:
            'Nitter and RSSHub are unofficial experimental bridges and may stop working without notice.',
        },
      },
      {
        name: 'nitterBaseUrl',
        type: 'text',
        label: 'Nitter-compatible base URL',
        admin: {
          description:
            'Use a trusted self-hosted instance. Public instances may disappear without notice.',
          condition: showNitterFields,
        },
      },
      {
        name: 'rssHubBaseUrl',
        type: 'text',
        label: 'RSSHub base URL',
        admin: {
          description:
            'Authentication headers remain server-side and are never stored in this global.',
          condition: showRssHubFields,
        },
      },
      {
        name: 'postLimit',
        type: 'number',
        defaultValue: 10,
        min: 1,
        max: 100,
        required: true,
      },
    {
      name: 'displayPostLimit',
      type: 'number',
      defaultValue: 3,
      min: 1,
      max: 5,
      required: true,
      label: 'Displayed post limit',
      admin: {
        description:
          'Maximum number of cached posts rendered by public views. This does not reduce the active snapshot.',
        step: 1,
      },
    },
      { name: 'excludeReplies', type: 'checkbox', defaultValue: true },
      { name: 'excludeReposts', type: 'checkbox', defaultValue: true },
      {
        name: 'syncIntervalMinutes',
        type: 'number',
        defaultValue: 60,
        min: 1,
        max: 1440,
        required: true,
      },
      {
        name: 'freshForMinutes',
        type: 'number',
        defaultValue: 90,
        min: 1,
        max: 43200,
        required: true,
      },
      {
        name: 'staleForHours',
        type: 'number',
        defaultValue: 24,
        min: 1,
        max: 720,
        required: true,
      },
      {
        name: 'failureThreshold',
        type: 'number',
        defaultValue: 3,
        min: 1,
        max: 20,
        required: true,
      },
      {
        name: 'notificationCooldownHours',
        type: 'number',
        defaultValue: 12,
        min: 1,
        max: 720,
        required: true,
      },
      { name: 'monitorState', type: 'json', admin: { hidden: true } },
      ...(options.monitor ? [createMonitorField(slug, options.monitor)] : []),
    ],
  }
}

function createMonitorField(
  settingsSlug: string,
  options: XFeedMonitorFieldOptions,
): Field {
  const pollIntervalMs = options.pollIntervalMs ?? 1500
  if (
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs < 750 ||
    pollIntervalMs > 60_000
  ) {
    throw new RangeError(
      'monitor.pollIntervalMs must be an integer between 750 and 60000.',
    )
  }

  return {
    name: 'monitor',
    type: 'ui',
    label: options.title ?? 'X Feed Monitor',
    admin: {
      disableListColumn: true,
      components: {
        Field: {
          path: options.componentPath ?? '@dss-feeds/x-feed/admin',
          exportName: 'XFeedMonitor',
          serverProps: {
            settingsSlug,
            ...(options.cacheSlug ? { cacheSlug: options.cacheSlug } : {}),
            ...(options.cacheKey ? { cacheKey: options.cacheKey } : {}),
            statusEndpointPath:
              options.statusEndpointPath ?? '/dss-x-feed/status',
            syncEndpointPath:
              options.syncEndpointPath ?? '/dss-x-feed/sync',
            pollIntervalMs,
            title: options.title ?? 'X Feed Monitor',
          },
        },
      },
    },
  }
}

function isAuthenticated({ req }: { req?: { user?: unknown } }): boolean {
  return Boolean(req?.user)
}

function showNitterFields(_data: unknown, siblingData: unknown): boolean {
  return (
    hasSourceMode(siblingData, 'nitter') ||
    hasSourceMode(siblingData, 'fallback')
  )
}

function showRssHubFields(_data: unknown, siblingData: unknown): boolean {
  return (
    hasSourceMode(siblingData, 'rsshub') ||
    hasSourceMode(siblingData, 'fallback')
  )
}

function hasSourceMode(value: unknown, mode: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sourceMode' in value &&
    value.sourceMode === mode
  )
}
