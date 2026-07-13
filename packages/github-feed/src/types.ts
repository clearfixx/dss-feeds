export interface GitHubFeedConfig {
  /**
   * GitHub account used by the API's commit author filter.
   */
  username: string

  /**
   * Repository names in `owner/name` form. A bare `name` uses username
   * as the owner.
   */
  repositories: readonly string[]

  /**
   * Maximum normalized commits returned after repositories are merged.
   */
  commitLimit?: number

  /**
   * Maximum commits requested from each repository. GitHub caps this at
   * 100.
   */
  perRepositoryLimit?: number

  /**
   * Request timeout in milliseconds.
   */
  timeoutMs?: number

  /**
   * GitHub REST API version header.
   */
  apiVersion?: string
}

export interface GitHubFeedRequestOptions {
  /**
   * Optional token supplied by server-side runtime configuration.
   * It must not be stored in public component props.
   */
  token?: string
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
}

export interface GitHubRepositoryRef {
  owner: string
  name: string
  fullName: string
}

export interface GitHubCommit {
  id: string
  source: 'github'
  kind: 'commit'
  sha: string
  shortSha: string
  repository: string
  repositoryUrl: string
  title: string
  committedAt: string
  url: string
  authorLogin: string | null
  authorName: string | null
}

export type GitHubFeedErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'REQUEST_ABORTED'
  | 'REQUEST_FAILED'
  | 'INVALID_RESPONSE'

export class GitHubFeedError extends Error {
  readonly code: GitHubFeedErrorCode
  readonly status: number | null
  readonly repository: string | null

  constructor(
    code: GitHubFeedErrorCode,
    message: string,
    options: {
      cause?: unknown
      repository?: string
      status?: number
    } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'GitHubFeedError'
    this.code = code
    this.status = options.status ?? null
    this.repository = options.repository ?? null
  }
}
