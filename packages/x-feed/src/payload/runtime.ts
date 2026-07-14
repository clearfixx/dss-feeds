import type { Payload } from 'payload'

import type { XFeedCachePolicy } from '../cache.js'
import type { XFeedMonitorPolicy } from '../monitor.js'
import { createFallbackXSource } from '../source/fallback.js'
import { createXRssSource } from '../source/rss.js'
import { createXApiSource } from '../source/x-api.js'
import {
  XFeedError,
  type XFeedConfig,
  type XFeedSource,
} from '../types.js'

export type PayloadXFeedSourceMode =
  | 'official-api'
  | 'nitter'
  | 'rsshub'
  | 'fallback'
  | 'custom'

export interface PayloadXFeedRuntimeSettings {
  enabled: boolean
  sourceMode: PayloadXFeedSourceMode
  nitterBaseUrl: string | null
  rssHubBaseUrl: string | null
  config: XFeedConfig
  cachePolicy: XFeedCachePolicy
  monitorPolicy: XFeedMonitorPolicy
}

export interface ReadPayloadXFeedRuntimeSettingsOptions {
  payload: Payload
  settingsSlug?: string
}

export interface CreatePayloadXFeedSourceOptions {
  settings: PayloadXFeedRuntimeSettings
  environment?: Readonly<Record<string, string | undefined>>
  fetch?: typeof globalThis.fetch
  xApiBearerTokenEnvironmentVariable?: string
  rssHubAuthorizationEnvironmentVariable?: string
  customSourceFactory?: (
    settings: PayloadXFeedRuntimeSettings,
  ) => XFeedSource | Promise<XFeedSource>
}

interface PayloadSettingsClient {
  findGlobal(args: {
    slug: string
    overrideAccess: true
  }): Promise<unknown>
}

const DEFAULT_SETTINGS_SLUG = 'dss-x-feed-settings'

export async function readPayloadXFeedRuntimeSettings(
  options: ReadPayloadXFeedRuntimeSettingsOptions,
): Promise<PayloadXFeedRuntimeSettings> {
  const client = options.payload as unknown as PayloadSettingsClient
  const value = await client.findGlobal({
    slug: options.settingsSlug ?? DEFAULT_SETTINGS_SLUG,
    overrideAccess: true,
  })

  if (!isRecord(value)) {
    throw invalidConfiguration('X feed settings are unavailable.')
  }

  const enabled = value.enabled === true
  const sourceMode = readSourceMode(value.sourceMode)
  const username = readOptionalString(value.username) ?? ''

  if (enabled && username.length === 0) {
    throw invalidConfiguration('X username is required when synchronization is enabled.')
  }

  return {
    enabled,
    sourceMode,
    nitterBaseUrl: readOptionalString(value.nitterBaseUrl),
    rssHubBaseUrl: readOptionalString(value.rssHubBaseUrl),
    config: {
      username,
      postLimit: readInteger(value.postLimit, 10, 1, 100, 'postLimit'),
      excludeReplies: value.excludeReplies !== false,
      excludeReposts: value.excludeReposts !== false,
    },
    cachePolicy: {
      syncIntervalMs:
        readInteger(
          value.syncIntervalMinutes,
          60,
          1,
          1440,
          'syncIntervalMinutes',
        ) * 60 * 1000,
      freshForMs:
        readInteger(
          value.freshForMinutes,
          90,
          1,
          43200,
          'freshForMinutes',
        ) * 60 * 1000,
      staleForMs:
        readInteger(
          value.staleForHours,
          24,
          1,
          720,
          'staleForHours',
        ) * 60 * 60 * 1000,
    },
    monitorPolicy: {
      failureThreshold: readInteger(
        value.failureThreshold,
        3,
        1,
        20,
        'failureThreshold',
      ),
      notificationCooldownMs:
        readInteger(
          value.notificationCooldownHours,
          12,
          1,
          720,
          'notificationCooldownHours',
        ) * 60 * 60 * 1000,
    },
  }
}

export async function createPayloadXFeedSource(
  options: CreatePayloadXFeedSourceOptions,
): Promise<XFeedSource> {
  const environment = options.environment ?? process.env
  const tokenEnvironmentVariable =
    options.xApiBearerTokenEnvironmentVariable ?? 'DSS_X_BEARER_TOKEN'
  const rssHubAuthorizationEnvironmentVariable =
    options.rssHubAuthorizationEnvironmentVariable ??
    'DSS_X_RSSHUB_AUTHORIZATION'
  assertEnvironmentVariableName(tokenEnvironmentVariable)
  assertEnvironmentVariableName(rssHubAuthorizationEnvironmentVariable)

  const createOfficial = (): XFeedSource => {
    const bearerToken = readEnvironmentValue(
      environment,
      tokenEnvironmentVariable,
    )
    if (!bearerToken) {
      throw invalidConfiguration(
        `Official X API source requires ${tokenEnvironmentVariable}.`,
      )
    }
    return createXApiSource({
      bearerToken,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
  }

  const createNitter = (): XFeedSource => {
    if (!options.settings.nitterBaseUrl) {
      throw invalidConfiguration(
        'Nitter-compatible source requires a configured base URL.',
      )
    }
    return createXRssSource({
      provider: 'nitter',
      baseUrl: options.settings.nitterBaseUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
  }

  const createRssHub = (): XFeedSource => {
    if (!options.settings.rssHubBaseUrl) {
      throw invalidConfiguration(
        'RSSHub source requires a configured base URL.',
      )
    }
    const authorization = readEnvironmentValue(
      environment,
      rssHubAuthorizationEnvironmentVariable,
    )
    return createXRssSource({
      provider: 'rsshub',
      baseUrl: options.settings.rssHubBaseUrl,
      ...(authorization
        ? { headers: { authorization } }
        : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
  }

  switch (options.settings.sourceMode) {
    case 'official-api':
      return createOfficial()
    case 'nitter':
      return createNitter()
    case 'rsshub':
      return createRssHub()
    case 'custom': {
      if (!options.customSourceFactory) {
        throw invalidConfiguration(
          'Custom X source mode requires customSourceFactory.',
        )
      }
      return options.customSourceFactory(options.settings)
    }
    case 'fallback': {
      const sources: XFeedSource[] = []
      if (options.settings.nitterBaseUrl) sources.push(createNitter())
      if (options.settings.rssHubBaseUrl) sources.push(createRssHub())
      if (readEnvironmentValue(environment, tokenEnvironmentVariable)) {
        sources.push(createOfficial())
      }
      if (sources.length === 0) {
        throw invalidConfiguration(
          'Fallback source requires at least one configured RSS bridge or official API token.',
        )
      }
      return createFallbackXSource({ sources })
    }
  }
}

function readSourceMode(value: unknown): PayloadXFeedSourceMode {
  return value === 'official-api' ||
    value === 'nitter' ||
    value === 'rsshub' ||
    value === 'fallback' ||
    value === 'custom'
    ? value
    : 'official-api'
}

function readInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value === null || value === undefined ? fallback : value
  if (
    typeof resolved !== 'number' ||
    !Number.isInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw invalidConfiguration(
      `${label} must be an integer between ${minimum} and ${maximum}.`,
    )
  }
  return resolved
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function readEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string | null {
  const value = environment[name]
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function assertEnvironmentVariableName(value: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) {
    throw new TypeError(
      'Environment variable names must use uppercase letters, numbers, and underscores.',
    )
  }
}

function invalidConfiguration(message: string): XFeedError {
  return new XFeedError('INVALID_CONFIGURATION', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
