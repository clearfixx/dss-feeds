import type { GlobalConfig } from 'payload'

export interface CreateXFeedSettingsOptions {
  slug?: string
  adminGroup?: string
}

const DEFAULT_SETTINGS_SLUG = 'dss-x-feed-settings'
const DEFAULT_ADMIN_GROUP = 'DSS Feeds'

export function createXFeedSettingsGlobal(
  options: CreateXFeedSettingsOptions = {},
): GlobalConfig {
  return {
    slug: options.slug ?? DEFAULT_SETTINGS_SLUG,
    label: 'X Feed Settings',
    admin: { group: options.adminGroup ?? DEFAULT_ADMIN_GROUP },
    access: { read: isAuthenticated, update: isAuthenticated },
    fields: [
      { name: 'enabled', type: 'checkbox', defaultValue: false, label: 'Enable X feed synchronization' },
      { name: 'username', type: 'text', label: 'X username', admin: { placeholder: 'username' } },
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
          description: 'Nitter and RSSHub are unofficial experimental bridges and may stop working without notice.',
        },
      },
      {
        name: 'nitterBaseUrl',
        type: 'text',
        label: 'Nitter-compatible base URL',
        admin: {
          description: 'Use a trusted self-hosted instance. Public instances may disappear without notice.',
          condition: showNitterFields,
        },
      },
      {
        name: 'rssHubBaseUrl',
        type: 'text',
        label: 'RSSHub base URL',
        admin: {
          description: 'Authentication headers remain server-side and are never stored in this global.',
          condition: showRssHubFields,
        },
      },
      { name: 'postLimit', type: 'number', defaultValue: 10, min: 1, max: 100, required: true },
      { name: 'excludeReplies', type: 'checkbox', defaultValue: true },
      { name: 'excludeReposts', type: 'checkbox', defaultValue: true },
      { name: 'syncIntervalMinutes', type: 'number', defaultValue: 60, min: 1, max: 1440, required: true },
      { name: 'freshForMinutes', type: 'number', defaultValue: 90, min: 1, max: 43200, required: true },
      { name: 'staleForHours', type: 'number', defaultValue: 24, min: 1, max: 720, required: true },
      { name: 'failureThreshold', type: 'number', defaultValue: 3, min: 1, max: 20, required: true },
      { name: 'notificationCooldownHours', type: 'number', defaultValue: 12, min: 1, max: 720, required: true },
      { name: 'monitorState', type: 'json', admin: { hidden: true } },
    ],
  }
}

function isAuthenticated({ req }: { req?: { user?: unknown } }): boolean {
  return Boolean(req?.user)
}


function showNitterFields(_data: unknown, siblingData: unknown): boolean {
  return hasSourceMode(siblingData, 'nitter') || hasSourceMode(siblingData, 'fallback')
}

function showRssHubFields(_data: unknown, siblingData: unknown): boolean {
  return hasSourceMode(siblingData, 'rsshub') || hasSourceMode(siblingData, 'fallback')
}

function hasSourceMode(value: unknown, mode: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sourceMode' in value &&
    value.sourceMode === mode
  )
}
