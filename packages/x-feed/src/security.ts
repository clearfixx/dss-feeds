import {
  XFeedError,
  type ResolvedXFeedConfig,
  type XFeedConfig,
  type XFeedSource,
} from './types.js'

const X_USERNAME_PATTERN = /^[A-Za-z0-9_]+$/
const SOURCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/

const DEFAULT_POST_LIMIT = 10
const MAX_POST_LIMIT = 100
const DEFAULT_TIMEOUT_MS = 10_000
const MIN_TIMEOUT_MS = 500
const MAX_TIMEOUT_MS = 30_000

export function resolveXFeedConfig(config: XFeedConfig): ResolvedXFeedConfig {
  if (!config || typeof config !== 'object') {
    throw invalidConfiguration('X feed configuration is required.')
  }

  return {
    username: assertXUsername(config.username),
    postLimit: assertIntegerInRange(
      config.postLimit,
      DEFAULT_POST_LIMIT,
      1,
      MAX_POST_LIMIT,
      'postLimit',
    ),
    excludeReplies: assertBoolean(
      config.excludeReplies,
      true,
      'excludeReplies',
    ),
    excludeReposts: assertBoolean(
      config.excludeReposts,
      true,
      'excludeReposts',
    ),
    timeoutMs: assertIntegerInRange(
      config.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
      'timeoutMs',
    ),
  }
}

export function assertXFeedSource(source: XFeedSource): XFeedSource {
  if (!source || typeof source !== 'object') {
    throw new XFeedError('INVALID_SOURCE', 'An X feed source is required.')
  }

  const id = typeof source.id === 'string' ? source.id.trim() : ''
  if (!SOURCE_ID_PATTERN.test(id)) {
    throw new XFeedError(
      'INVALID_SOURCE',
      'X feed source id must be a lowercase identifier.',
    )
  }

  if (typeof source.fetchPosts !== 'function') {
    throw new XFeedError(
      'INVALID_SOURCE',
      `X feed source "${id}" must implement fetchPosts().`,
      { sourceId: id },
    )
  }

  return source
}

export function assertXUsername(username: string): string {
  const normalized =
    typeof username === 'string' ? username.trim().replace(/^@/, '') : ''

  // X documents 15 characters as typical, while historical accounts may be
  // longer. The wider ceiling preserves compatibility without accepting an
  // unbounded identifier.
  if (
    normalized.length === 0 ||
    normalized.length > 50 ||
    !X_USERNAME_PATTERN.test(normalized)
  ) {
    throw invalidConfiguration('X username is invalid.')
  }

  return normalized
}

function assertBoolean(
  value: boolean | undefined,
  fallback: boolean,
  field: string,
): boolean {
  if (value === undefined) {
    return fallback
  }

  if (typeof value !== 'boolean') {
    throw invalidConfiguration(`${field} must be a boolean.`)
  }

  return value
}

function assertIntegerInRange(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const normalized = value ?? fallback

  if (
    !Number.isInteger(normalized) ||
    normalized < minimum ||
    normalized > maximum
  ) {
    throw invalidConfiguration(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    )
  }

  return normalized
}

function invalidConfiguration(message: string): XFeedError {
  return new XFeedError('INVALID_CONFIGURATION', message)
}
