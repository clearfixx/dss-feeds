import {
  assertHttpsUrl,
  assertInstagramUsername,
  assertResultLimit,
  assertTimeout,
} from './security.js'
import {
  InstagramFeedError,
  type InstagramFeedConfig,
  type InstagramFeedRequestOptions,
  type InstagramProviderPost,
} from './types.js'

const GRAPHQL_ENDPOINT = 'https://www.instagram.com/graphql/query/'
const DEFAULT_DOCUMENT_ID = '25403009626063073'
const DEFAULT_FRIENDLY_NAME = 'PolarisProfilePostsQuery'
const DEFAULT_WEB_APP_ID = '936619743392459'
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'

type RecordValue = Record<string, unknown>

export async function fetchExperimentalInstagramPosts(
  config: InstagramFeedConfig,
  options: InstagramFeedRequestOptions = {},
): Promise<InstagramProviderPost[]> {
  const username = assertInstagramUsername(config.username)
  const limit = assertResultLimit(config.fetchLimit)
  const timeoutMs = assertTimeout(config.timeoutMs)
  const credentials = options.experimental
  const request = options.fetch ?? globalThis.fetch

  if (
    !credentials?.sessionId.trim() ||
    !credentials.csrfToken.trim()
  ) {
    throw new InstagramFeedError(
      'AUTHENTICATION_REQUIRED',
      'Experimental Instagram GraphQL source requires session ID and CSRF token.',
      {
        source: 'experimental-web-session',
      },
    )
  }

  if (typeof request !== 'function') {
    throw new InstagramFeedError(
      'INVALID_CONFIGURATION',
      'A Fetch API implementation is required.',
      {
        source: 'experimental-web-session',
      },
    )
  }

  const documentId = normalizeDocumentId(
    credentials.documentId,
  )
  const appId =
    credentials.appId.trim() || DEFAULT_WEB_APP_ID
  const variables = createVariables(username, limit)
  const body = new URLSearchParams()

  body.set('__a', '1')
  body.set('__d', 'www')
  body.set('__comet_req', '7')
  body.set('doc_id', documentId)
  body.set(
    'fb_api_req_friendly_name',
    DEFAULT_FRIENDLY_NAME,
  )
  body.set(
    'server_timestamps',
    'true',
  )
  body.set(
    'variables',
    JSON.stringify(variables),
  )

  const cookie = [
    `sessionid=${encodeURIComponent(credentials.sessionId.trim())}`,
    `csrftoken=${encodeURIComponent(credentials.csrfToken.trim())}`,
    credentials.dsUserId?.trim()
      ? `ds_user_id=${encodeURIComponent(credentials.dsUserId.trim())}`
      : null,
  ]
    .filter(Boolean)
    .join('; ')
  const timeout = createRequestSignal(
    timeoutMs,
    options.signal,
  )

  let response: Response

  try {
    response = await request(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type':
          'application/x-www-form-urlencoded;charset=UTF-8',
        Cookie: cookie,
        Origin: 'https://www.instagram.com',
        Referer: `https://www.instagram.com/${encodeURIComponent(username)}/`,
        'User-Agent':
          credentials.userAgent?.trim() ||
          DEFAULT_USER_AGENT,
        'X-CSRFToken':
          credentials.csrfToken.trim(),
        'X-FB-Friendly-Name':
          DEFAULT_FRIENDLY_NAME,
        'X-IG-App-ID': appId,
        'X-Requested-With':
          'XMLHttpRequest',
      },
      body: body.toString(),
      signal: timeout.signal,
    })
  } catch (error) {
    timeout.dispose()

    throw new InstagramFeedError(
      timeout.signal.aborted
        ? 'REQUEST_ABORTED'
        : 'REQUEST_FAILED',
      timeout.signal.aborted
        ? 'Experimental Instagram GraphQL request was aborted.'
        : `Experimental Instagram GraphQL request failed: ${describeRequestFailure(error)}.`,
      {
        cause: error,
        source: 'experimental-web-session',
      },
    )
  }

  timeout.dispose()

  if (!response.ok) {
    throw new InstagramFeedError(
      response.status === 401 ||
        response.status === 403 ||
        response.status === 429
        ? 'AUTHENTICATION_REQUIRED'
        : 'REQUEST_FAILED',
      `Experimental Instagram GraphQL source returned HTTP ${response.status}.`,
      {
        source: 'experimental-web-session',
        status: response.status,
      },
    )
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch (error) {
    throw new InstagramFeedError(
      'INVALID_RESPONSE',
      'Experimental Instagram GraphQL source returned invalid JSON.',
      {
        cause: error,
        source: 'experimental-web-session',
        status: response.status,
      },
    )
  }

  const connection = readPath(payload, [
    'data',
    'xdt_api__v1__feed__user_timeline_graphql_connection',
  ])

  if (!isRecord(connection)) {
    throw new InstagramFeedError(
      'INVALID_RESPONSE',
      'Experimental Instagram GraphQL source returned an unexpected profile timeline response. The document ID may have changed.',
      {
        source: 'experimental-web-session',
      },
    )
  }

  const edges = connection.edges

  if (!Array.isArray(edges)) {
    throw new InstagramFeedError(
      'INVALID_RESPONSE',
      'Experimental Instagram GraphQL source did not return timeline edges.',
      {
        source: 'experimental-web-session',
      },
    )
  }

  return deduplicateAndSort(
    edges
      .map((edge) =>
        normalizePost(
          edge,
          username,
          config.includeVideos === true,
        ),
      )
      .filter(
        (
          post,
        ): post is InstagramProviderPost =>
          post !== null,
      ),
  ).slice(0, limit)
}

function describeRequestFailure(
  error: unknown,
): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const parts = [error.message]
  const cause = error.cause

  if (cause instanceof Error) {
    if (
      cause.message &&
      cause.message !== error.message
    ) {
      parts.push(cause.message)
    }

    const causeWithCode = cause as Error & {
      code?: unknown
    }

    if (
      typeof causeWithCode.code === 'string'
    ) {
      parts.push(causeWithCode.code)
    }
  } else if (
    typeof cause === 'object' &&
    cause !== null
  ) {
    const causeRecord = cause as {
      code?: unknown
      message?: unknown
    }

    if (
      typeof causeRecord.message ===
      'string'
    ) {
      parts.push(causeRecord.message)
    }

    if (
      typeof causeRecord.code === 'string'
    ) {
      parts.push(causeRecord.code)
    }
  }

  return [...new Set(parts)]
    .filter(Boolean)
    .join(' / ')
}

function createVariables(
  username: string,
  count: number,
): Record<string, unknown> {
  return {
    data: {
      count,
      include_reel_media_seen_timestamp: true,
      include_relationship_info: true,
      latest_besties_reel_media: true,
      latest_reel_media: true,
    },
    username,
    __relay_internal__pv__PolarisImmersiveFeedChainingEnabledrelayprovider:
      true,
    __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider:
      false,
    __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:
      false,
    __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider:
      false,
  }
}

function normalizePost(
  edge: unknown,
  configuredUsername: string,
  includeVideos: boolean,
): InstagramProviderPost | null {
  if (
    !isRecord(edge) ||
    !isRecord(edge.node)
  ) {
    return null
  }

  const node = edge.node
  const id =
    readString(node.pk) ??
    readString(node.id)
  const shortcode = readString(node.code)
  const mediaTypeCode = readNumber(node.media_type)
  const carouselItems = Array.isArray(
    node.carousel_media,
  )
    ? node.carousel_media
    : []
  const isCarousel =
    mediaTypeCode === 8 ||
    carouselItems.length > 0
  const isVideo =
    mediaTypeCode === 2

  if (isVideo && !includeVideos) {
    return null
  }

  const timestamp = readNumber(node.taken_at)

  if (
    !id ||
    !shortcode ||
    timestamp === null
  ) {
    return null
  }

  const mediaSource =
    isCarousel &&
    isRecord(carouselItems[0])
      ? carouselItems[0]
      : node
  const imageCandidate =
    selectBestImageCandidate(mediaSource) ??
    selectBestImageCandidate(node)

  if (!imageCandidate) {
    return null
  }

  const username =
    readPathString(node, [
      'user',
      'username',
    ]) ?? configuredUsername
  const productType =
    readString(node.product_type)
  const permalinkSegment =
    productType === 'clips' ||
    productType === 'reels'
      ? 'reel'
      : 'p'

  return {
    id,
    shortcode,
    mediaType: isVideo
      ? 'video'
      : isCarousel
        ? 'carousel'
        : 'image',
    mediaProductType: productType,
    providerImageUrl: assertHttpsUrl(
      imageCandidate.url,
      'Instagram media URL',
    ),
    providerThumbnailUrl: null,
    permalink:
      `https://www.instagram.com/${permalinkSegment}/${encodeURIComponent(shortcode)}/`,
    caption:
      readPathString(node, [
        'caption',
        'text',
      ]),
    publishedAt: new Date(
      timestamp * 1000,
    ).toISOString(),
    likeCount: readCount(
      node.like_count,
    ),
    commentCount: readCount(
      node.comment_count,
    ),
    username,
    width:
      readPositiveInteger(
        node.original_width,
      ) ?? imageCandidate.width,
    height:
      readPositiveInteger(
        node.original_height,
      ) ?? imageCandidate.height,
  }
}

interface ImageCandidate {
  url: string
  width: number | null
  height: number | null
}

function selectBestImageCandidate(
  value: unknown,
): ImageCandidate | null {
  const candidates = readPath(value, [
    'image_versions2',
    'candidates',
  ])

  if (!Array.isArray(candidates)) {
    return null
  }

  const validCandidates = candidates
    .map((candidate): ImageCandidate | null => {
      if (!isRecord(candidate)) {
        return null
      }

      const url = readString(candidate.url)

      if (!url) {
        return null
      }

      return {
        url,
        width: readPositiveInteger(
          candidate.width,
        ),
        height: readPositiveInteger(
          candidate.height,
        ),
      }
    })
    .filter(
      (
        candidate,
      ): candidate is ImageCandidate =>
        candidate !== null,
    )

  if (validCandidates.length === 0) {
    return null
  }

  return (
    validCandidates.sort(
      (left, right) =>
        candidateArea(right) -
        candidateArea(left),
    )[0] ?? null
  )
}

function candidateArea(
  candidate: ImageCandidate,
): number {
  return (
    (candidate.width ?? 0) *
    (candidate.height ?? 0)
  )
}

function normalizeDocumentId(
  value: string | undefined,
): string {
  const documentId =
    value?.trim() || DEFAULT_DOCUMENT_ID

  if (!/^\d{8,30}$/.test(documentId)) {
    throw new InstagramFeedError(
      'INVALID_CONFIGURATION',
      'Instagram GraphQL document ID must contain only digits.',
      {
        source: 'experimental-web-session',
      },
    )
  }

  return documentId
}

function readPath(
  value: unknown,
  keys: readonly string[],
): unknown {
  let current = value

  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined
    }

    current = current[key]
  }

  return current
}

function readPathString(
  value: unknown,
  keys: readonly string[],
): string | null {
  return readString(
    readPath(value, keys),
  )
}

function readString(
  value: unknown,
): string | null {
  return typeof value === 'string' &&
    value.trim()
    ? value.trim()
    : null
}

function readNumber(
  value: unknown,
): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value)
    ? value
    : null
}

function readCount(
  value: unknown,
): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
    ? Math.trunc(value)
    : null
}

function readPositiveInteger(
  value: unknown,
): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0
    ? Math.trunc(value)
    : null
}

function isRecord(
  value: unknown,
): value is RecordValue {
  return (
    typeof value === 'object' &&
    value !== null
  )
}

function deduplicateAndSort(
  posts: readonly InstagramProviderPost[],
): InstagramProviderPost[] {
  const unique = new Map(
    posts.map((post) => [
      post.id,
      post,
    ]),
  )

  return [...unique.values()].sort(
    (left, right) =>
      Date.parse(right.publishedAt) -
      Date.parse(left.publishedAt),
  )
}

function createRequestSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): {
  signal: AbortSignal
  dispose(): void
} {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs,
  )
  const abort = () =>
    controller.abort()

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      externalSignal.addEventListener(
        'abort',
        abort,
        {
          once: true,
        },
      )
    }
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      externalSignal?.removeEventListener(
        'abort',
        abort,
      )
    },
  }
}
