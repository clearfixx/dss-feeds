import type { Payload } from 'payload'

import type { GitHubCommit } from '../types.js'

export type GitHubFeedCacheState =
  | 'empty'
  | 'fresh'
  | 'stale'
  | 'expired'
  | 'unavailable'

export interface GitHubFeedCacheTiming {
  freshUntil: string
  staleUntil: string
}

export interface GitHubFeedReadResult {
  state: GitHubFeedCacheState
  renderable: boolean
  commits: readonly GitHubCommit[]
  checksum: string | null
  adapterVersion: string | null
  generatedAt: string | null
  freshUntil: string | null
  staleUntil: string | null
  nextSyncAt: string | null
  warnings: readonly string[]
}

export interface ReadGitHubFeedOptions {
  payload: Payload
  cacheSlug?: string
  cacheKey?: string
  commitCount?: number
  repositories?: readonly string[]
  order?: 'asc' | 'desc'
  now?: Date
}

interface GitHubFeedPayloadReader {
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
  }): Promise<{
    docs: unknown[]
  }>
}

const DEFAULT_CACHE_SLUG =
  'dss-github-feed-cache'
const DEFAULT_CACHE_KEY = 'github:default'
const DEFAULT_COMMIT_COUNT = 3
const MAX_COMMIT_COUNT = 100

export async function readGitHubFeed(
  options: ReadGitHubFeedOptions,
): Promise<GitHubFeedReadResult> {
  const now = options.now ?? new Date()

  if (Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date')
  }

  const commitCount = normalizeCommitCount(
    options.commitCount,
  )
  const repositoryFilter =
    normalizeRepositoryFilter(
      options.repositories,
    )
  const order = options.order ?? 'desc'
  const payload =
    options.payload as unknown as GitHubFeedPayloadReader

  let result: {
    docs: unknown[]
  }

  try {
    result = await payload.find({
      collection:
        options.cacheSlug ??
        DEFAULT_CACHE_SLUG,
      where: {
        key: {
          equals:
            options.cacheKey ??
            DEFAULT_CACHE_KEY,
        },
      },
      limit: 1,
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
  } catch {
    return createEmptyResult('unavailable')
  }

  const rawSnapshot = result.docs[0]

  if (!isRecord(rawSnapshot)) {
    return createEmptyResult('empty')
  }

  const generatedAt = readDateString(
    rawSnapshot.generatedAt,
  )
  const freshUntil = readDateString(
    rawSnapshot.freshUntil,
  )
  const staleUntil = readDateString(
    rawSnapshot.staleUntil,
  )
  const nextSyncAt = readDateString(
    rawSnapshot.nextSyncAt,
  )
  const checksum = readOptionalString(
    rawSnapshot.checksum,
  )
  const adapterVersion = readOptionalString(
    rawSnapshot.adapterVersion,
  )
  const warnings = readWarnings(
    rawSnapshot.warnings,
  )

  if (!freshUntil || !staleUntil) {
    return {
      ...createEmptyResult('expired'),
      checksum,
      adapterVersion,
      generatedAt,
      freshUntil,
      staleUntil,
      nextSyncAt,
      warnings,
    }
  }

  const state =
    resolveGitHubFeedCacheState(
      {
        freshUntil,
        staleUntil,
      },
      now,
    )

  if (
    state !== 'fresh' &&
    state !== 'stale'
  ) {
    return {
      state,
      renderable: false,
      commits: [],
      checksum,
      adapterVersion,
      generatedAt,
      freshUntil,
      staleUntil,
      nextSyncAt,
      warnings,
    }
  }

  const commits = readCommits(
    rawSnapshot.commits,
  )
    .filter((commit) =>
      matchesRepositoryFilter(
        commit.repository,
        repositoryFilter,
      ),
    )
    .sort((left, right) => {
      const difference =
        Date.parse(left.committedAt) -
        Date.parse(right.committedAt)

      return order === 'asc'
        ? difference
        : -difference
    })
    .slice(0, commitCount)

  return {
    state,
    renderable: commits.length > 0,
    commits,
    checksum,
    adapterVersion,
    generatedAt,
    freshUntil,
    staleUntil,
    nextSyncAt,
    warnings,
  }
}

export function resolveGitHubFeedCacheState(
  timing: GitHubFeedCacheTiming,
  now: Date = new Date(),
): Exclude<
  GitHubFeedCacheState,
  'empty' | 'unavailable'
> {
  const nowTimestamp = now.getTime()
  const freshUntilTimestamp =
    Date.parse(timing.freshUntil)
  const staleUntilTimestamp =
    Date.parse(timing.staleUntil)

  if (
    Number.isNaN(nowTimestamp) ||
    Number.isNaN(
      freshUntilTimestamp,
    ) ||
    Number.isNaN(
      staleUntilTimestamp,
    )
  ) {
    return 'expired'
  }

  if (
    nowTimestamp <=
    freshUntilTimestamp
  ) {
    return 'fresh'
  }

  if (
    nowTimestamp <=
    staleUntilTimestamp
  ) {
    return 'stale'
  }

  return 'expired'
}

function readCommits(
  value: unknown,
): GitHubCommit[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const commit =
      parsePayloadCommit(entry)

    return commit ? [commit] : []
  })
}

function parsePayloadCommit(
  value: unknown,
): GitHubCommit | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readRequiredString(
    value.externalId,
  )
  const sha = readRequiredString(
    value.sha,
  )
  const shortSha =
    readRequiredString(value.shortSha)
  const repository =
    readRequiredString(value.repository)
  const repositoryUrl =
    readRequiredString(
      value.repositoryUrl,
    )
  const title =
    readRequiredString(value.title)
  const committedAt =
    readDateString(value.committedAt)
  const url =
    readRequiredString(value.url)

  if (
    !id ||
    !sha ||
    !shortSha ||
    !repository ||
    !repositoryUrl ||
    !title ||
    !committedAt ||
    !url
  ) {
    return null
  }

  return {
    id,
    source: 'github',
    kind: 'commit',
    sha,
    shortSha,
    repository,
    repositoryUrl,
    title,
    committedAt,
    url,
    authorLogin:
      readOptionalString(
        value.authorLogin,
      ),
    authorName:
      readOptionalString(
        value.authorName,
      ),
  }
}

function readWarnings(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }

    const message =
      readOptionalString(entry.message)

    return message ? [message] : []
  })
}

function normalizeCommitCount(
  value: number | undefined,
): number {
  const resolved =
    value ?? DEFAULT_COMMIT_COUNT

  if (
    !Number.isInteger(resolved) ||
    resolved < 1 ||
    resolved > MAX_COMMIT_COUNT
  ) {
    throw new RangeError(
      `commitCount must be an integer between 1 and ${MAX_COMMIT_COUNT}.`,
    )
  }

  return resolved
}

function normalizeRepositoryFilter(
  repositories:
    | readonly string[]
    | undefined,
): Set<string> | null {
  if (!repositories) {
    return null
  }

  const normalized = repositories
    .map((repository) =>
      repository.trim().toLowerCase(),
    )
    .filter(Boolean)

  return new Set(normalized)
}

function matchesRepositoryFilter(
  repository: string,
  filter: Set<string> | null,
): boolean {
  if (!filter) {
    return true
  }

  return filter.has(
    repository.toLowerCase(),
  )
}

function createEmptyResult(
  state:
    | 'empty'
    | 'expired'
    | 'unavailable',
): GitHubFeedReadResult {
  return {
    state,
    renderable: false,
    commits: [],
    checksum: null,
    adapterVersion: null,
    generatedAt: null,
    freshUntil: null,
    staleUntil: null,
    nextSyncAt: null,
    warnings: [],
  }
}

function readDateString(
  value: unknown,
): string | null {
  const raw = readOptionalString(value)

  if (!raw) {
    return null
  }

  const timestamp = Date.parse(raw)

  return Number.isNaN(timestamp)
    ? null
    : new Date(timestamp).toISOString()
}

function readRequiredString(
  value: unknown,
): string | null {
  return readOptionalString(value)
}

function readOptionalString(
  value: unknown,
): string | null {
  return typeof value === 'string' &&
    value.trim().length > 0
    ? value.trim()
    : null
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null
  )
}
