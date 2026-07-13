import {
  GitHubFeedError,
  type GitHubRepositoryRef,
} from './types.js'

const GITHUB_IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/
const MAX_REPOSITORIES = 20
const MAX_RESULTS = 100

export function assertGitHubUsername(username: string): string {
  const normalized = username.trim()

  if (
    normalized.length === 0 ||
    normalized.length > 39 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(
      normalized,
    ) ||
    normalized.includes('--')
  ) {
    throw new GitHubFeedError(
      'INVALID_CONFIGURATION',
      'GitHub username is invalid.',
    )
  }

  return normalized
}

export function normalizeGitHubRepositories(
  repositories: readonly string[],
  defaultOwner: string,
): GitHubRepositoryRef[] {
  if (
    repositories.length === 0 ||
    repositories.length > MAX_REPOSITORIES
  ) {
    throw new GitHubFeedError(
      'INVALID_CONFIGURATION',
      `Configure between 1 and ${MAX_REPOSITORIES} repositories.`,
    )
  }

  const unique = new Map<string, GitHubRepositoryRef>()

  for (const repository of repositories) {
    const normalized = normalizeGitHubRepository(
      repository,
      defaultOwner,
    )

    unique.set(normalized.fullName.toLowerCase(), normalized)
  }

  return [...unique.values()]
}

export function normalizeGitHubRepository(
  repository: string,
  defaultOwner: string,
): GitHubRepositoryRef {
  const parts = repository
    .trim()
    .split('/')
    .map((part) => part.trim())

  if (parts.length === 1) {
    parts.unshift(defaultOwner)
  }

  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    !GITHUB_IDENTIFIER_PATTERN.test(parts[0]) ||
    !GITHUB_IDENTIFIER_PATTERN.test(parts[1])
  ) {
    throw new GitHubFeedError(
      'INVALID_CONFIGURATION',
      `Repository "${repository}" must use the owner/name format.`,
    )
  }

  const [owner, name] = parts

  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
  }
}

export function clampResultLimit(
  value: number | undefined,
  fallback: number,
): number {
  const resolved = value ?? fallback

  if (!Number.isInteger(resolved) || resolved < 1 || resolved > MAX_RESULTS) {
    throw new GitHubFeedError(
      'INVALID_CONFIGURATION',
      `Result limit must be an integer between 1 and ${MAX_RESULTS}.`,
    )
  }

  return resolved
}

export function assertTimeout(timeoutMs: number | undefined): number {
  const resolved = timeoutMs ?? 10_000

  if (
    !Number.isInteger(resolved) ||
    resolved < 1_000 ||
    resolved > 60_000
  ) {
    throw new GitHubFeedError(
      'INVALID_CONFIGURATION',
      'Request timeout must be between 1000 and 60000 milliseconds.',
    )
  }

  return resolved
}

export function assertApiVersion(apiVersion: string | undefined): string {
  const resolved = apiVersion ?? '2026-03-10'

  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolved)) {
    throw new GitHubFeedError(
      'INVALID_CONFIGURATION',
      'GitHub API version must use YYYY-MM-DD format.',
    )
  }

  return resolved
}
