import { normalizeXPost } from './normalize.js'
import {
  assertXFeedSource,
  resolveXFeedConfig,
  resolveXFeedSinceId,
} from './security.js'
import {
  XFeedError,
  type XFeedConfig,
  type XFeedRequestOptions,
  type XFeedSource,
  type XPost,
} from './types.js'

export async function collectXPosts(
  source: XFeedSource,
  config: XFeedConfig,
  options: XFeedRequestOptions = {},
): Promise<XPost[]> {
  const validatedSource = assertXFeedSource(source)
  const resolvedConfig = resolveXFeedConfig(config)
  const requestSignal = createRequestSignal(
    resolvedConfig.timeoutMs,
    options.signal,
  )

  let payload: unknown

  try {
    payload = await validatedSource.fetchPosts({
      config: resolvedConfig,
      signal: requestSignal.signal,
      sinceId: resolveXFeedSinceId(options.sinceId),
    })
  } catch (error) {
    if (error instanceof XFeedError) {
      throw error
    }

    if (requestSignal.signal.aborted) {
      throw new XFeedError(
        'REQUEST_ABORTED',
        `X feed source "${validatedSource.id}" was aborted.`,
        {
          cause: error,
          sourceId: validatedSource.id,
        },
      )
    }

    throw new XFeedError(
      'REQUEST_FAILED',
      `X feed source "${validatedSource.id}" failed.`,
      {
        cause: error,
        sourceId: validatedSource.id,
      },
    )
  } finally {
    requestSignal.dispose()
  }

  if (!Array.isArray(payload)) {
    throw new XFeedError(
      'INVALID_RESPONSE',
      `X feed source "${validatedSource.id}" returned a non-array payload.`,
      { sourceId: validatedSource.id },
    )
  }

  const posts = payload.map((post) =>
    normalizeXPost(post, validatedSource.id),
  )

  return filterDeduplicateAndSort(posts, resolvedConfig).slice(
    0,
    resolvedConfig.postLimit,
  )
}

function filterDeduplicateAndSort(
  posts: readonly XPost[],
  config: {
    excludeReplies: boolean
    excludeReposts: boolean
  },
): XPost[] {
  const unique = new Map<string, XPost>()

  for (const post of posts) {
    const isReply = post.references.some(
      (reference) => reference.type === 'replied_to',
    )
    const isRepost = post.references.some(
      (reference) => reference.type === 'reposted',
    )

    if (
      (config.excludeReplies && isReply) ||
      (config.excludeReposts && isRepost)
    ) {
      continue
    }

    unique.set(post.id, post)
  }

  return [...unique.values()].sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt),
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
      externalSignal.addEventListener('abort', abortFromExternalSignal, {
        once: true,
      })
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
