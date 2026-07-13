import {
  assertApiVersion,
  assertGitHubUsername,
  assertTimeout,
  clampResultLimit,
  normalizeGitHubRepositories,
} from './security.js'
import {
  GitHubFeedError,
  type GitHubCommit,
  type GitHubFeedConfig,
  type GitHubFeedRequestOptions,
  type GitHubRepositoryRef,
} from './types.js'

interface GitHubCommitApiResponse {
  sha?: unknown
  html_url?: unknown
  author?: {
    login?: unknown
  } | null
  commit?: {
    message?: unknown
    author?: {
      name?: unknown
      date?: unknown
    } | null
    committer?: {
      date?: unknown
    } | null
  } | null
}

const GITHUB_API_BASE_URL = 'https://api.github.com'
const GITHUB_WEB_BASE_URL = 'https://github.com'
const USER_AGENT = '@dss-feeds/github-feed'

export async function fetchGitHubCommits(
  config: GitHubFeedConfig,
  options: GitHubFeedRequestOptions = {},
): Promise<GitHubCommit[]> {
  const username = assertGitHubUsername(config.username)
  const repositories = normalizeGitHubRepositories(
    config.repositories,
    username,
  )
  const commitLimit = clampResultLimit(config.commitLimit, 10)
  const perRepositoryLimit = clampResultLimit(
    config.perRepositoryLimit,
    Math.max(commitLimit, 10),
  )
  const timeoutMs = assertTimeout(config.timeoutMs)
  const apiVersion = assertApiVersion(config.apiVersion)
  const request = options.fetch ?? globalThis.fetch

  if (typeof request !== 'function') {
    throw new GitHubFeedError(
      'INVALID_CONFIGURATION',
      'A Fetch API implementation is required.',
    )
  }

  const commits: GitHubCommit[] = []

  // Requests are intentionally sequential to avoid unnecessary bursts
  // against GitHub's API and secondary rate limits.
  for (const repository of repositories) {
    const repositoryCommits = await fetchRepositoryCommits({
      repository,
      username,
      perRepositoryLimit,
      timeoutMs,
      apiVersion,
      request,
      token: options.token,
      signal: options.signal,
    })

    commits.push(...repositoryCommits)
  }

  return deduplicateAndSortCommits(commits).slice(0, commitLimit)
}

interface FetchRepositoryCommitsInput {
  repository: GitHubRepositoryRef
  username: string
  perRepositoryLimit: number
  timeoutMs: number
  apiVersion: string
  request: typeof globalThis.fetch
  token?: string
  signal?: AbortSignal
}

async function fetchRepositoryCommits(
  input: FetchRepositoryCommitsInput,
): Promise<GitHubCommit[]> {
  const url = new URL(
    `/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(
      input.repository.name,
    )}/commits`,
    GITHUB_API_BASE_URL,
  )

  url.searchParams.set('author', input.username)
  url.searchParams.set('per_page', String(input.perRepositoryLimit))

  const headers = new Headers({
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': input.apiVersion,
  })

  if (input.token?.trim()) {
    headers.set('Authorization', `Bearer ${input.token.trim()}`)
  }

  const requestSignal = createRequestSignal(
    input.timeoutMs,
    input.signal,
  )

  let response: Response

  try {
    response = await input.request(url, {
      headers,
      signal: requestSignal.signal,
    })
  } catch (error) {
    requestSignal.dispose()

    if (requestSignal.signal.aborted) {
      throw new GitHubFeedError(
        'REQUEST_ABORTED',
        `GitHub request was aborted for ${input.repository.fullName}.`,
        {
          cause: error,
          repository: input.repository.fullName,
        },
      )
    }

    throw new GitHubFeedError(
      'REQUEST_FAILED',
      `GitHub request failed for ${input.repository.fullName}.`,
      {
        cause: error,
        repository: input.repository.fullName,
      },
    )
  }

  requestSignal.dispose()

  if (!response.ok) {
    throw new GitHubFeedError(
      'REQUEST_FAILED',
      `GitHub returned HTTP ${response.status} for ${input.repository.fullName}.`,
      {
        repository: input.repository.fullName,
        status: response.status,
      },
    )
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch (error) {
    throw new GitHubFeedError(
      'INVALID_RESPONSE',
      `GitHub returned invalid JSON for ${input.repository.fullName}.`,
      {
        cause: error,
        repository: input.repository.fullName,
        status: response.status,
      },
    )
  }

  if (!Array.isArray(payload)) {
    throw new GitHubFeedError(
      'INVALID_RESPONSE',
      `GitHub returned an unexpected response for ${input.repository.fullName}.`,
      {
        repository: input.repository.fullName,
        status: response.status,
      },
    )
  }

  return payload.map((entry) =>
    normalizeGitHubCommit(entry, input.repository),
  )
}

function normalizeGitHubCommit(
  value: unknown,
  repository: GitHubRepositoryRef,
): GitHubCommit {
  if (!isRecord(value)) {
    throw invalidCommitResponse(repository.fullName)
  }

  const response = value as GitHubCommitApiResponse
  const sha = readNonEmptyString(response.sha)
  const url = readNonEmptyString(response.html_url)
  const message = readNonEmptyString(response.commit?.message)
  const committedAt =
    readOptionalString(response.commit?.committer?.date) ??
    readOptionalString(response.commit?.author?.date)
  const authorLogin = readOptionalString(response.author?.login)
  const authorName = readOptionalString(response.commit?.author?.name)

  if (!sha || !url || !message || !committedAt) {
    throw invalidCommitResponse(repository.fullName)
  }

  const timestamp = Date.parse(committedAt)

  if (Number.isNaN(timestamp)) {
    throw invalidCommitResponse(repository.fullName)
  }

  return {
    id: `${repository.fullName}@${sha}`,
    source: 'github',
    kind: 'commit',
    sha,
    shortSha: sha.slice(0, 7),
    repository: repository.fullName,
    repositoryUrl: `${GITHUB_WEB_BASE_URL}/${repository.fullName}`,
    title: firstLine(message),
    committedAt: new Date(timestamp).toISOString(),
    url,
    authorLogin,
    authorName,
  }
}

function deduplicateAndSortCommits(
  commits: readonly GitHubCommit[],
): GitHubCommit[] {
  const unique = new Map<string, GitHubCommit>()

  for (const commit of commits) {
    unique.set(commit.id, commit)
  }

  return [...unique.values()].sort(
    (left, right) =>
      Date.parse(right.committedAt) - Date.parse(left.committedAt),
  )
}

function firstLine(message: string): string {
  return message.split(/\r?\n/, 1)[0]?.trim() || message.trim()
}

function readNonEmptyString(value: unknown): string | null {
  return readOptionalString(value)
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function invalidCommitResponse(repository: string): GitHubFeedError {
  return new GitHubFeedError(
    'INVALID_RESPONSE',
    `GitHub returned an invalid commit record for ${repository}.`,
    {
      repository,
    },
  )
}

interface RequestSignal {
  signal: AbortSignal
  dispose(): void
}

function createRequestSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): RequestSignal {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const abortFromExternalSignal = () => controller.abort()

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      externalSignal.addEventListener(
        'abort',
        abortFromExternalSignal,
        {
          once: true,
        },
      )
    }
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout)
      externalSignal?.removeEventListener(
        'abort',
        abortFromExternalSignal,
      )
    },
  }
}
