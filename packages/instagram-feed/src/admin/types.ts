import type {
  InstagramFeedCacheState,
} from '../payload/read.js'
import type {
  InstagramFeedRuntimeTrigger,
} from '../payload/state.js'

export type InstagramFeedAdminJobStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'skipped'
  | 'error'

export type InstagramFeedAdminEventLevel =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'

export interface InstagramFeedAdminEvent {
  level: InstagramFeedAdminEventLevel
  message: string
  timestamp: string
  context?: Readonly<
    Record<string, unknown>
  >
}

export interface InstagramFeedAdminJob {
  id: string
  status: InstagramFeedAdminJobStatus
  createdAt: string | null
  completedAt: string | null
  totalTried: number
  durationMs: number | null
  trigger:
    | InstagramFeedRuntimeTrigger
    | null
  events:
    readonly InstagramFeedAdminEvent[]
}

export interface InstagramFeedAdminStatus {
  checkedAt: string
  cache: {
    state: InstagramFeedCacheState
    renderable: boolean
    cachedPostCount: number
    checksum: string | null
    adapterVersion: string | null
    generatedAt: string | null
    freshUntil: string | null
    staleUntil: string | null
    nextSyncAt: string | null
    warnings: readonly string[]
  }
  jobs:
    readonly InstagramFeedAdminJob[]
  jobsAvailable: boolean
}
