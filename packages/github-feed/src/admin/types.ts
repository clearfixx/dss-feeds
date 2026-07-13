import type {
  GitHubFeedCacheState,
} from '../payload/read.js'

export type GitHubFeedAdminJobStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'error'

export type GitHubFeedAdminEventLevel =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'

export interface GitHubFeedAdminEvent {
  level: GitHubFeedAdminEventLevel
  message: string
  timestamp: string
  context?: Readonly<
    Record<string, unknown>
  >
}

export interface GitHubFeedAdminJob {
  id: string
  status: GitHubFeedAdminJobStatus
  createdAt: string | null
  completedAt: string | null
  totalTried: number
  events: readonly GitHubFeedAdminEvent[]
}

export interface GitHubFeedAdminStatus {
  checkedAt: string
  cache: {
    state: GitHubFeedCacheState
    renderable: boolean
    cachedCommitCount: number
    checksum: string | null
    adapterVersion: string | null
    generatedAt: string | null
    freshUntil: string | null
    staleUntil: string | null
    nextSyncAt: string | null
    warnings: readonly string[]
  }
  jobs: readonly GitHubFeedAdminJob[]
  jobsAvailable: boolean
}
