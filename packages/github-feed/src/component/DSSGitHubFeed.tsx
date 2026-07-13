import type {
  ReactNode,
} from 'react'

import type { GitHubCommit } from '../types.js'

export interface DSSGitHubFeedProps {
  /**
   * Normalized commits loaded from a local cache.
   *
   * This component never contacts GitHub or Payload.
   */
  commits: readonly GitHubCommit[]

  /**
   * Maximum number of rendered commits.
   */
  commitCount?: number

  /**
   * Optional repository filter applied before the display limit.
   */
  repositories?: readonly string[]

  /**
   * Commit ordering by committedAt.
   */
  order?: 'asc' | 'desc'

  className?: string
  ariaLabel?: string
  heading?: ReactNode
  profileUrl?: string
  profileLabel?: ReactNode
  emptyState?: ReactNode

  showRepository?: boolean
  showSha?: boolean
  showDate?: boolean

  /**
   * Deterministic default is UTC to avoid server/client timezone drift.
   */
  timeZone?: string
  locale?: string

  formatDate?: (
    committedAt: string,
    commit: GitHubCommit,
  ) => ReactNode

  renderItem?: (
    commit: GitHubCommit,
    index: number,
  ) => ReactNode
}

const DEFAULT_COMMIT_COUNT = 3
const MAX_COMMIT_COUNT = 100

export function DSSGitHubFeed({
  commits,
  commitCount = DEFAULT_COMMIT_COUNT,
  repositories,
  order = 'desc',
  className,
  ariaLabel = 'Recent GitHub commits',
  heading = 'Recent commits',
  profileUrl,
  profileLabel = 'View GitHub',
  emptyState = null,
  showRepository = true,
  showSha = true,
  showDate = true,
  timeZone = 'UTC',
  locale = 'en',
  formatDate,
  renderItem,
}: DSSGitHubFeedProps): ReactNode {
  const limit = normalizeCommitCount(commitCount)
  const repositoryFilter =
    normalizeRepositoryFilter(repositories)

  const visibleCommits = [...commits]
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
    .slice(0, limit)

  if (visibleCommits.length === 0) {
    return emptyState
  }

  const rootClassName = [
    'dss-github-feed',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section
      className={rootClassName}
      aria-label={ariaLabel}
    >
      {(heading ||
        (profileUrl &&
          isSafeGitHubUrl(profileUrl))) && (
        <header className="dss-github-feed__header">
          {heading && (
            <h2 className="dss-github-feed__heading">
              {heading}
            </h2>
          )}

          {profileUrl &&
            isSafeGitHubUrl(profileUrl) && (
              <a
                className="dss-github-feed__profile-link"
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
              >
                {profileLabel}
              </a>
            )}
        </header>
      )}

      <ol className="dss-github-feed__list">
        {visibleCommits.map(
          (commit, index) => (
            <li
              className="dss-github-feed__item"
              key={commit.id}
            >
              {renderItem
                ? renderItem(commit, index)
                : (
                    <DefaultCommitItem
                      commit={commit}
                      showRepository={
                        showRepository
                      }
                      showSha={showSha}
                      showDate={showDate}
                      timeZone={timeZone}
                      locale={locale}
                      formatDate={
                        formatDate
                      }
                    />
                  )}
            </li>
          ),
        )}
      </ol>
    </section>
  )
}

interface DefaultCommitItemProps {
  commit: GitHubCommit
  showRepository: boolean
  showSha: boolean
  showDate: boolean
  timeZone: string
  locale: string
  formatDate:
    | DSSGitHubFeedProps['formatDate']
    | undefined
}

function DefaultCommitItem({
  commit,
  showRepository,
  showSha,
  showDate,
  timeZone,
  locale,
  formatDate,
}: DefaultCommitItemProps): ReactNode {
  const safeCommitUrl =
    isSafeGitHubUrl(commit.url)
  const safeRepositoryUrl =
    isSafeGitHubUrl(
      commit.repositoryUrl,
    )

  const title = safeCommitUrl
    ? (
        <a
          className="dss-github-feed__title-link"
          href={commit.url}
          target="_blank"
          rel="noreferrer"
        >
          {commit.title}
        </a>
      )
    : (
        <span className="dss-github-feed__title">
          {commit.title}
        </span>
      )

  return (
    <article className="dss-github-feed__commit">
      {(showRepository ||
        showDate) && (
        <div className="dss-github-feed__meta">
          {showRepository &&
            (safeRepositoryUrl
              ? (
                  <a
                    className="dss-github-feed__repository"
                    href={
                      commit.repositoryUrl
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {commit.repository}
                  </a>
                )
              : (
                  <span className="dss-github-feed__repository">
                    {commit.repository}
                  </span>
                ))}

          {showDate && (
            <time
              className="dss-github-feed__date"
              dateTime={
                commit.committedAt
              }
            >
              {formatDate
                ? formatDate(
                    commit.committedAt,
                    commit,
                  )
                : formatCommitDate(
                    commit.committedAt,
                    locale,
                    timeZone,
                  )}
            </time>
          )}
        </div>
      )}

      <div className="dss-github-feed__content">
        {showSha && (
          <code className="dss-github-feed__sha">
            {commit.shortSha}
          </code>
        )}

        {title}
      </div>
    </article>
  )
}

function normalizeCommitCount(
  value: number,
): number {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_COMMIT_COUNT
  ) {
    throw new RangeError(
      `commitCount must be an integer between 1 and ${MAX_COMMIT_COUNT}.`,
    )
  }

  return value
}

function normalizeRepositoryFilter(
  repositories:
    | readonly string[]
    | undefined,
): Set<string> | null {
  if (!repositories) {
    return null
  }

  return new Set(
    repositories
      .map((repository) =>
        repository
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  )
}

function matchesRepositoryFilter(
  repository: string,
  filter: Set<string> | null,
): boolean {
  return (
    !filter ||
    filter.has(
      repository.toLowerCase(),
    )
  )
}

function formatCommitDate(
  committedAt: string,
  locale: string,
  timeZone: string,
): string {
  const timestamp =
    Date.parse(committedAt)

  if (Number.isNaN(timestamp)) {
    return committedAt
  }

  try {
    return new Intl.DateTimeFormat(
      locale,
      {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      },
    ).format(new Date(timestamp))
  } catch {
    return new Date(
      timestamp,
    ).toISOString()
  }
}

function isSafeGitHubUrl(
  value: string,
): boolean {
  try {
    const url = new URL(value)

    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com'
    )
  } catch {
    return false
  }
}
