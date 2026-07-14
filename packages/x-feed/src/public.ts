import {
  assertXFeedCacheKey,
  createXFeedCacheKey,
  readXFeedSnapshot,
  type XFeedCacheState,
  type XFeedSnapshotStore,
} from './cache.js'
import type {
  XPost,
  XPostMediaType,
  XPostMetrics,
} from './types.js'

export interface XFeedPublicAuthor {
  username: string
  name: string
  profileImageUrl: string | null
  verified: boolean | null
}

export interface XFeedPublicMedia {
  type: XPostMediaType
  url: string | null
  previewImageUrl: string | null
  altText: string | null
  width: number | null
  height: number | null
  durationMs: number | null
}

export interface XFeedPublicPost {
  id: string
  url: string
  text: string
  createdAt: string
  language: string | null
  author: XFeedPublicAuthor
  metrics: XPostMetrics
  media: readonly XFeedPublicMedia[]
  isReply: boolean
  isQuote: boolean
  isRepost: boolean
}

export interface XFeedPublicResult {
  state: XFeedCacheState
  renderable: boolean
  stale: boolean
  cachedPostCount: number
  posts: readonly XFeedPublicPost[]
  generatedAt: string | null
  freshUntil: string | null
  staleUntil: string | null
}

interface XFeedPublicReadBaseOptions {
  store: XFeedSnapshotStore
  postCount?: number
  order?: 'asc' | 'desc'
  now?: Date
}

export type XFeedPublicReadOptions =
  | (XFeedPublicReadBaseOptions & {
      username: string
      key?: never
    })
  | (XFeedPublicReadBaseOptions & {
      key: string
      username?: never
    })

export async function readXFeedPublic(
  options: XFeedPublicReadOptions,
): Promise<XFeedPublicResult> {
  const key = resolvePublicReadKey(options)
  const result = await readXFeedSnapshot({
    store: options.store,
    key,
    ...(options.postCount === undefined
      ? {}
      : { postCount: options.postCount }),
    ...(options.order === undefined ? {} : { order: options.order }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })

  return {
    state: result.state,
    renderable: result.renderable,
    stale: result.state === 'stale',
    cachedPostCount: result.cachedPostCount,
    posts: result.posts.map(toPublicPost),
    generatedAt: result.generatedAt,
    freshUntil: result.freshUntil,
    staleUntil: result.staleUntil,
  }
}

function resolvePublicReadKey(options: XFeedPublicReadOptions): string {
  if ('username' in options && typeof options.username === 'string') {
    return createXFeedCacheKey(options.username)
  }

  return assertXFeedCacheKey(options.key)
}

function toPublicPost(post: XPost): XFeedPublicPost {
  return {
    id: post.id,
    url: post.url,
    text: post.text,
    createdAt: post.createdAt,
    language: post.language,
    author: {
      username: post.author.username,
      name: post.author.name,
      profileImageUrl: post.author.profileImageUrl,
      verified: post.author.verified,
    },
    metrics: { ...post.metrics },
    media: post.media.map((media) => ({
      type: media.type,
      url: media.url,
      previewImageUrl: media.previewImageUrl,
      altText: media.altText,
      width: media.width,
      height: media.height,
      durationMs: media.durationMs,
    })),
    isReply: post.references.some(
      (reference) => reference.type === 'replied_to',
    ),
    isQuote: post.references.some(
      (reference) => reference.type === 'quoted',
    ),
    isRepost: post.references.some(
      (reference) => reference.type === 'reposted',
    ),
  }
}
