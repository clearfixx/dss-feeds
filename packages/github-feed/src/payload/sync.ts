import { createHash } from 'node:crypto'

import type { Payload } from 'payload'

import { fetchGitHubCommits } from '../github.js'
import {
  GitHubFeedError,
  type GitHubCommit,
} from '../types.js'

export const GITHUB_FEED_ADAPTER_VERSION = '0.0.0'

export type GitHubFeedSyncLogLevel =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'

export interface GitHubFeedSyncLogEntry {
  level: GitHubFeedSyncLogLevel
  message: string
  timestamp: string
  context?: Readonly<Record<string, unknown>>
}

export interface GitHubFeedSyncResult {
  status: 'success' | 'skipped'
  reason?: 'disabled'
  cacheKey: string
  created: boolean
  changed: boolean
  commitCount: number
  checksum: string | null
  generatedAt: string | null
  freshUntil: string | null
  staleUntil: string | null
  nextSyncAt: string | null
}

export interface SynchronizeGitHubFeedOptions {
  payload: Payload
  token?: string
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
  now?: Date
  cacheKey?: string
  settingsSlug?: string
  cacheSlug?: string
  onLog?: (
    entry: GitHubFeedSyncLogEntry,
  ) => void | Promise<void>
}

interface GitHubFeedSettingsData {
  enabled: boolean
  username: string
  repositories: string[]
  commitLimit: number
  syncIntervalHours: number
  freshForMinutes: number
  staleForHours: number
}

interface PayloadDocument {
  id: string | number
  checksum?: unknown
}

interface PayloadFindResult {
  docs: PayloadDocument[]
}

interface GitHubFeedPayloadClient {
  findGlobal(args: {
    slug: string
    overrideAccess: boolean
  }): Promise<unknown>

  find(args: {
    collection: string
    where: {
      key: {
        equals: string
      }
    }
    limit: number
    depth: number
    pagination: boolean
    overrideAccess: boolean
  }): Promise<PayloadFindResult>

  create(args: {
    collection: string
    data: Record<string, unknown>
    overrideAccess: boolean
  }): Promise<unknown>

  update(args: {
    collection: string
    id: string | number
    data: Record<string, unknown>
    overrideAccess: boolean
  }): Promise<unknown>
}

const DEFAULT_SETTINGS_SLUG = 'dss-github-feed-settings'
const DEFAULT_CACHE_SLUG = 'dss-github-feed-cache'
const DEFAULT_CACHE_KEY = 'github:default'

export async function synchronizeGitHubFeed(
  options: SynchronizeGitHubFeedOptions,
): Promise<GitHubFeedSyncResult> {
  const now = options.now ?? new Date()

  if (Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date')
  }

  const settingsSlug =
    options.settingsSlug ?? DEFAULT_SETTINGS_SLUG
  const cacheSlug = options.cacheSlug ?? DEFAULT_CACHE_SLUG
  const cacheKey = options.cacheKey ?? DEFAULT_CACHE_KEY
  const payload = options.payload as unknown as GitHubFeedPayloadClient

  await writeLog(options, now, 'info', 'Loading GitHub feed settings.')

  const rawSettings = await payload.findGlobal({
    slug: settingsSlug,
    overrideAccess: true,
  })
  const settings = parseSettings(rawSettings)

  if (!settings.enabled) {
    await writeLog(
      options,
      now,
      'info',
      'GitHub feed synchronization is disabled.',
    )

    return {
      status: 'skipped',
      reason: 'disabled',
      cacheKey,
      created: false,
      changed: false,
      commitCount: 0,
      checksum: null,
      generatedAt: null,
      freshUntil: null,
      staleUntil: null,
      nextSyncAt: null,
    }
  }

  await writeLog(
    options,
    now,
    'info',
    'Requesting commits from GitHub.',
    {
      username: settings.username,
      repositories: settings.repositories,
      commitLimit: settings.commitLimit,
    },
  )

  let commits: GitHubCommit[]

  try {
    commits = await fetchGitHubCommits(
      {
        username: settings.username,
        repositories: settings.repositories,
        commitLimit: settings.commitLimit,
      },
      {
        token: options.token,
        fetch: options.fetch,
        signal: options.signal,
      },
    )
  } catch (error) {
    await writeLog(
      options,
      new Date(),
      'error',
      'GitHub synchronization failed before the cache was modified.',
      {
        code:
          error instanceof GitHubFeedError
            ? error.code
            : 'UNKNOWN_ERROR',
      },
    )

    throw error
  }

  const generatedAt = now.toISOString()
  const freshUntil = addMilliseconds(
    now,
    settings.freshForMinutes * 60 * 1000,
  ).toISOString()
  const staleUntil = addMilliseconds(
    new Date(freshUntil),
    settings.staleForHours * 60 * 60 * 1000,
  ).toISOString()
  const nextSyncAt = addMilliseconds(
    now,
    settings.syncIntervalHours * 60 * 60 * 1000,
  ).toISOString()
  const checksum = createCommitChecksum(commits)

  if (commits.length === 0) {
    await writeLog(
      options,
      now,
      'warning',
      'GitHub returned no commits for the configured repositories.',
    )
  }

  const existing = await payload.find({
    collection: cacheSlug,
    where: {
      key: {
        equals: cacheKey,
      },
    },
    limit: 1,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const existingSnapshot = existing.docs[0]
  const changed = existingSnapshot?.checksum !== checksum

  const snapshotData = {
    key: cacheKey,
    username: settings.username,
    repositories: settings.repositories.map((repository) => ({
      repository,
    })),
    commits: commits.map(toPayloadCommit),
    checksum,
    adapterVersion: GITHUB_FEED_ADAPTER_VERSION,
    generatedAt,
    freshUntil,
    staleUntil,
    nextSyncAt,
    warnings:
      commits.length === 0
        ? [
            {
              message:
                'GitHub returned no commits for the configured repositories.',
            },
          ]
        : [],
  }

  if (existingSnapshot) {
    await payload.update({
      collection: cacheSlug,
      id: existingSnapshot.id,
      data: snapshotData,
      overrideAccess: true,
    })
  } else {
    await payload.create({
      collection: cacheSlug,
      data: snapshotData,
      overrideAccess: true,
    })
  }

  await writeLog(
    options,
    now,
    'success',
    existingSnapshot
      ? 'GitHub feed cache was replaced successfully.'
      : 'GitHub feed cache was created successfully.',
    {
      commitCount: commits.length,
      changed,
      cacheKey,
    },
  )

  return {
    status: 'success',
    cacheKey,
    created: !existingSnapshot,
    changed,
    commitCount: commits.length,
    checksum,
    generatedAt,
    freshUntil,
    staleUntil,
    nextSyncAt,
  }
}

export function createCommitChecksum(
  commits: readonly GitHubCommit[],
): string {
  const serialized = commits.map((commit) => ({
    id: commit.id,
    sha: commit.sha,
    repository: commit.repository,
    title: commit.title,
    committedAt: commit.committedAt,
    url: commit.url,
    authorLogin: commit.authorLogin,
    authorName: commit.authorName,
  }))

  return createHash('sha256')
    .update(JSON.stringify(serialized))
    .digest('hex')
}

function parseSettings(value: unknown): GitHubFeedSettingsData {
  if (!isRecord(value)) {
    throw invalidSettings('GitHub feed settings are unavailable.')
  }

  const enabled = value.enabled === true

  if (!enabled) {
    return {
      enabled: false,
      username: '',
      repositories: [],
      commitLimit: 10,
      syncIntervalHours: 1,
      freshForMinutes: 90,
      staleForHours: 24,
    }
  }

  const username = readRequiredString(
    value.username,
    'GitHub username is required.',
  )
  const repositories = readRepositories(value.repositories)

  return {
    enabled: true,
    username,
    repositories,
    commitLimit: readInteger(
      value.commitLimit,
      10,
      1,
      100,
      'Cached commit limit',
    ),
    syncIntervalHours: readInteger(
      value.syncIntervalHours,
      1,
      1,
      24,
      'Synchronization interval',
    ),
    freshForMinutes: readInteger(
      value.freshForMinutes,
      90,
      15,
      1440,
      'Fresh cache lifetime',
    ),
    staleForHours: readInteger(
      value.staleForHours,
      24,
      1,
      168,
      'Stale fallback lifetime',
    ),
  }
}

function readRepositories(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidSettings(
      'At least one GitHub repository is required.',
    )
  }

  const repositories = value.map((entry) => {
    if (!isRecord(entry)) {
      throw invalidSettings(
        'GitHub repository settings are invalid.',
      )
    }

    return readRequiredString(
      entry.repository,
      'GitHub repository is required.',
    )
  })

  if (repositories.length > 20) {
    throw invalidSettings(
      'No more than 20 GitHub repositories can be configured.',
    )
  }

  return repositories
}

function readInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value === undefined || value === null
    ? fallback
    : value

  if (
    typeof resolved !== 'number' ||
    !Number.isInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw invalidSettings(
      `${label} must be an integer between ${minimum} and ${maximum}.`,
    )
  }

  return resolved
}

function readRequiredString(
  value: unknown,
  message: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidSettings(message)
  }

  return value.trim()
}

function invalidSettings(message: string): GitHubFeedError {
  return new GitHubFeedError(
    'INVALID_CONFIGURATION',
    message,
  )
}

function toPayloadCommit(
  commit: GitHubCommit,
): Record<string, unknown> {
  return {
    externalId: commit.id,
    sha: commit.sha,
    shortSha: commit.shortSha,
    repository: commit.repository,
    repositoryUrl: commit.repositoryUrl,
    title: commit.title,
    committedAt: commit.committedAt,
    url: commit.url,
    ...(commit.authorLogin
      ? { authorLogin: commit.authorLogin }
      : {}),
    ...(commit.authorName
      ? { authorName: commit.authorName }
      : {}),
  }
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function writeLog(
  options: SynchronizeGitHubFeedOptions,
  timestamp: Date,
  level: GitHubFeedSyncLogLevel,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (!options.onLog) {
    return
  }

  await options.onLog({
    level,
    message,
    timestamp: timestamp.toISOString(),
    ...(context ? { context } : {}),
  })
}
