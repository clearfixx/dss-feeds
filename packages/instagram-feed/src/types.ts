import type { Payload } from 'payload'

export type InstagramSourceMode =
  | 'official'
  | 'experimental-web-session'
  | 'official-with-experimental-fallback'

export type InstagramSource =
  | 'official'
  | 'experimental-web-session'

export type InstagramMediaType = 'image' | 'carousel' | 'video'

export interface InstagramProviderPost {
  id: string
  shortcode: string | null
  mediaType: InstagramMediaType
  mediaProductType: string | null
  providerImageUrl: string
  providerThumbnailUrl: string | null
  permalink: string
  caption: string | null
  publishedAt: string
  likeCount: number | null
  commentCount: number | null
  username: string
  width: number | null
  height: number | null
}

export interface InstagramPost extends InstagramProviderPost {
  source: 'instagram'
  kind: 'post'
  imageUrl: string
  thumbnailUrl: string | null
}

export interface InstagramOfficialCredentials {
  accessToken: string
  userId: string
}

export interface InstagramWebSessionCredentials {
  sessionId: string
  csrfToken: string
  dsUserId?: string
  appId: string
  documentId?: string
  userAgent?: string
}

export interface InstagramFeedConfig {
  username: string
  sourceMode: InstagramSourceMode
  fetchLimit?: number
  includeVideos?: boolean
  timeoutMs?: number
  graphVersion?: string
}

export interface InstagramFeedRequestOptions {
  official?: InstagramOfficialCredentials
  experimental?: InstagramWebSessionCredentials
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
}

export interface InstagramFetchResult {
  posts: readonly InstagramProviderPost[]
  sourceUsed: InstagramSource
  warnings: readonly string[]
}

export interface InstagramMediaMirrorInput {
  payload: Payload
  post: InstagramProviderPost
  fetch: typeof globalThis.fetch
  signal?: AbortSignal
}

export interface InstagramMediaMirrorResult {
  imageUrl: string
  thumbnailUrl?: string | null
}

export type InstagramMediaMirror = (
  input: InstagramMediaMirrorInput,
) => Promise<InstagramMediaMirrorResult> | InstagramMediaMirrorResult

export type InstagramFeedErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'REQUEST_ABORTED'
  | 'REQUEST_FAILED'
  | 'INVALID_RESPONSE'
  | 'AUTHENTICATION_REQUIRED'
  | 'MEDIA_MIRROR_REQUIRED'
  | 'MEDIA_MIRROR_FAILED'

export class InstagramFeedError extends Error {
  readonly code: InstagramFeedErrorCode
  readonly status: number | null
  readonly source: InstagramSource | null

  constructor(
    code: InstagramFeedErrorCode,
    message: string,
    options: { cause?: unknown; source?: InstagramSource; status?: number } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'InstagramFeedError'
    this.code = code
    this.status = options.status ?? null
    this.source = options.source ?? null
  }
}
