import type { Field, GlobalConfig } from 'payload'
import { isAuthenticatedPayloadRequest } from './access.js'

export interface InstagramFeedMonitorFieldOptions {
  componentPath?: string
  cacheSlug: string
  cacheKey: string
  taskSlug: string
  syncEndpointPath: string
  jobLimit?: number
  pollIntervalMs?: number
}

export interface CreateInstagramFeedSettingsOptions {
  slug: string
  adminGroup: string
  monitor: InstagramFeedMonitorFieldOptions
}

export function createInstagramFeedSettings(options: CreateInstagramFeedSettingsOptions): GlobalConfig {
  return {
    slug: options.slug,
    label: 'Instagram Feed Settings',
    admin: { group: options.adminGroup },
    access: { read: isAuthenticatedPayloadRequest, update: isAuthenticatedPayloadRequest },
    fields: [
      { name: 'enabled', type: 'checkbox', defaultValue: false, label: 'Enable Instagram feed synchronization' },
      {
        name: 'username', type: 'text', label: 'Instagram username',
        admin: { description: 'Public profile username without @.', placeholder: 'your.username' },
      },
      {
        name: 'sourceMode', type: 'select', defaultValue: 'official', required: true, label: 'Content source',
        options: [
          { label: 'Official Instagram API', value: 'official' },
          { label: 'Experimental web session', value: 'experimental-web-session' },
          { label: 'Official API with experimental fallback', value: 'official-with-experimental-fallback' },
        ],
        admin: { description: 'The experimental source uses a logged-in Instagram web session and may break when Instagram changes private web endpoints.' },
      },
      {
        name: 'fetchLimit', type: 'number', defaultValue: 12, min: 1, max: 50, required: true, label: 'Cached post limit',
        admin: { description: 'Maximum normalized posts retained in the active snapshot.', step: 1 },
      },
      {
        name: 'displayPostLimit', type: 'number', defaultValue: 6, min: 1, max: 24, required: true, label: 'Posts displayed on the website',
        admin: { description: 'Public views read this many newest posts from the larger cached snapshot.', step: 1 },
      },
      { name: 'includeVideos', type: 'checkbox', defaultValue: false, label: 'Include videos and Reels as thumbnails' },
      {
        name: 'syncIntervalHours', type: 'number', defaultValue: 6, min: 1, max: 24, required: true, label: 'Synchronization interval',
        admin: { description: 'The scheduled task checks this value before contacting Instagram.', step: 1 },
      },
      {
        name: 'freshForMinutes', type: 'number', defaultValue: 390, min: 15, max: 1440, required: true, label: 'Fresh cache lifetime',
        admin: { description: 'A successful snapshot is considered fresh for this many minutes.', step: 1 },
      },
      {
        name: 'staleForHours', type: 'number', defaultValue: 168, min: 1, max: 720, required: true, label: 'Stale fallback lifetime',
        admin: { description: 'The last successful snapshot remains renderable after freshness expires.', step: 1 },
      },
      {
        name: 'graphVersion', type: 'text', defaultValue: 'v25.0', required: true, label: 'Official Graph API version',
        admin: { description: 'Used only by the official source.' },
      },
      { name: 'timeoutMs', type: 'number', defaultValue: 15000, min: 1000, max: 60000, required: true, label: 'Provider request timeout', admin: { step: 1000 } },
      {
        name: 'credentialsHelp', type: 'ui', label: 'Server credentials',
        admin: { components: { Field: { path: '@dss-feeds/instagram-feed/admin', exportName: 'InstagramCredentialsHelp' } } },
      },
      ...createRuntimeFields(),
      {
        name: 'monitor', type: 'ui', label: 'Instagram Feed Monitor',
        admin: {
          disableListColumn: true,
          components: {
            Field: {
              path: options.monitor.componentPath ?? '@dss-feeds/instagram-feed/admin',
              exportName: 'InstagramFeedMonitor',
              serverProps: {
                settingsSlug: options.slug,
                cacheSlug: options.monitor.cacheSlug,
                cacheKey: options.monitor.cacheKey,
                taskSlug: options.monitor.taskSlug,
                syncEndpointPath: options.monitor.syncEndpointPath,
                jobLimit: options.monitor.jobLimit ?? 5,
                pollIntervalMs: options.monitor.pollIntervalMs ?? 1500,
              },
            },
          },
        },
      },
    ],
  }
}

function createRuntimeFields(): Field[] {
  const hiddenAdmin = { hidden: true } as const
  return [
    { name: 'monitorStatus', type: 'select', defaultValue: 'idle', options: [
      { label: 'Idle', value: 'idle' }, { label: 'Running', value: 'running' },
      { label: 'Success', value: 'success' }, { label: 'Skipped', value: 'skipped' },
      { label: 'Error', value: 'error' },
    ], admin: hiddenAdmin },
    { name: 'monitorRunId', type: 'text', admin: hiddenAdmin },
    { name: 'monitorTrigger', type: 'select', options: [
      { label: 'Schedule', value: 'schedule' }, { label: 'Manual', value: 'manual' }, { label: 'Endpoint', value: 'endpoint' },
    ], admin: hiddenAdmin },
    { name: 'monitorAttemptCount', type: 'number', defaultValue: 0, min: 0, admin: hiddenAdmin },
    { name: 'monitorLastAttemptAt', type: 'date', admin: hiddenAdmin },
    { name: 'monitorLastSuccessAt', type: 'date', admin: hiddenAdmin },
    { name: 'monitorCompletedAt', type: 'date', admin: hiddenAdmin },
    { name: 'monitorDurationMs', type: 'number', min: 0, admin: hiddenAdmin },
    { name: 'monitorPostCount', type: 'number', defaultValue: 0, min: 0, admin: hiddenAdmin },
    { name: 'monitorChecksum', type: 'text', admin: hiddenAdmin },
    { name: 'monitorGeneratedAt', type: 'date', admin: hiddenAdmin },
    { name: 'monitorFreshUntil', type: 'date', admin: hiddenAdmin },
    { name: 'monitorStaleUntil', type: 'date', admin: hiddenAdmin },
    { name: 'monitorNextSyncAt', type: 'date', admin: hiddenAdmin },
    { name: 'monitorAdapterVersion', type: 'text', admin: hiddenAdmin },
    { name: 'monitorLastError', type: 'textarea', admin: hiddenAdmin },
    {
      name: 'monitorEvents', type: 'array', maxRows: 20, admin: hiddenAdmin,
      fields: [
        { name: 'level', type: 'select', required: true, options: [
          { label: 'Info', value: 'info' }, { label: 'Success', value: 'success' },
          { label: 'Warning', value: 'warning' }, { label: 'Error', value: 'error' },
        ] },
        { name: 'message', type: 'text', required: true },
        { name: 'timestamp', type: 'date', required: true },
        { name: 'context', type: 'json' },
      ],
    },
  ]
}
