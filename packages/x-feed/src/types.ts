export interface XFeedConfig {
  /**
   * Public X handle. A leading `@` is accepted and removed.
   */
  username: string
  /**
   * Maximum normalized posts returned after filtering and deduplication.
   */
  postLimit?: number
  /**
   * Exclude posts that reference another post as a reply.
   */
  excludeReplies?: boolean
  /**
   * Exclude reposts.
   */
  excludeReposts?: boolean
  /**
   * Source request timeout in milliseconds.
   */
  timeoutMs?: number
}

export interface ResolvedXFeedConfig {
  username: string
  postLimit: number
  excludeReplies: boolean
  excludeReposts: boolean
  timeoutMs: number
}

export interface XFeedRequestOptions {
  signal?: AbortSignal
  /**
   * Fetch only posts newer than this X post ID when the source supports it.
   */
  sinceId?: string
}

export interface XFeedSourceContext {
  config: ResolvedXFeedConfig
  signal: AbortSignal
  sinceId: string | null
}

export type XFeedSourceKind =
  | 'official-api'
  | 'rss-bridge'
  | 'fallback'
  | 'custom'

export type XFeedSourceStability =
  | 'stable'
  | 'experimental'
  | 'composite'
  | 'unknown'

export interface XFeedSourceMetadata {
  kind: XFeedSourceKind
  stability: XFeedSourceStability
  label: string
  official: boolean | null
  warning: string | null
}

export interface XFeedSource {
  /**
   * Stable adapter identifier used in diagnostics.
   */
  readonly id: string
  /**
   * Optional operational metadata for admin UIs and monitoring.
   * Built-in adapters always provide it; custom sources may omit it.
   */
  readonly metadata?: XFeedSourceMetadata
  /**
   * Fetches already normalized X posts. Credentials stay inside the adapter.
   */
  fetchPosts(context: XFeedSourceContext): Promise<readonly XPost[]>
}

export interface XPostAuthor {
  /**
   * Numeric X user ID when the source can resolve it. RSS sources may omit it.
   */
  id: string | null
  username: string
  name: string
  profileImageUrl: string | null
  verified: boolean | null
  protected: boolean | null
}

export interface XPostMetrics {
  replies: number
  reposts: number
  likes: number
  quotes: number
  bookmarks: number | null
  impressions: number | null
}

export type XPostMediaType = 'photo' | 'video' | 'animated_gif'

export interface XPostMedia {
  key: string
  type: XPostMediaType
  url: string | null
  previewImageUrl: string | null
  altText: string | null
  width: number | null
  height: number | null
  durationMs: number | null
}

export type XPostReferenceType = 'replied_to' | 'quoted' | 'reposted'

export interface XPostReference {
  type: XPostReferenceType
  postId: string
}

export interface XPost {
  id: string
  source: 'x'
  kind: 'post'
  url: string
  text: string
  createdAt: string
  language: string | null
  conversationId: string | null
  author: XPostAuthor
  metrics: XPostMetrics
  media: readonly XPostMedia[]
  references: readonly XPostReference[]
}

export type XFeedErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_SOURCE'
  | 'REQUEST_ABORTED'
  | 'AUTHENTICATION_FAILED'
  | 'ACCESS_FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'REQUEST_FAILED'
  | 'INVALID_RESPONSE'
  | 'CACHE_READ_FAILED'
  | 'CACHE_WRITE_FAILED'

export class XFeedError extends Error {
  readonly code: XFeedErrorCode
  readonly sourceId: string | null
  readonly status: number | null

  constructor(
    code: XFeedErrorCode,
    message: string,
    options: {
      cause?: unknown
      sourceId?: string
      status?: number
    } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'XFeedError'
    this.code = code
    this.sourceId = options.sourceId ?? null
    this.status = options.status ?? null
  }
}
