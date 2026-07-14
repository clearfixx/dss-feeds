import { assertXFeedSource } from '../security.js'
import { getXFeedSourceMetadata } from '../source-metadata.js'
import {
  XFeedError,
  type XFeedSource,
  type XFeedSourceContext,
} from '../types.js'

const FALLBACK_SOURCE_ID = 'x-fallback'

export interface XFallbackAttemptInfo {
  sourceId: string
  index: number
  outcome: 'success' | 'empty' | 'error'
  error: XFeedError | null
}

export interface XFallbackSourceOptions {
  /**
   * Sources are attempted in order.
   */
  sources: readonly XFeedSource[]
  /**
   * Continue to the next source when a source returns no posts.
   * Disabled by default so an incremental sync with no new posts does not
   * accidentally fall through to a paid provider.
   */
  fallbackOnEmpty?: boolean
  /**
   * Optional diagnostics hook for every attempted source.
   */
  onAttempt?: (info: XFallbackAttemptInfo) => void
}

/**
 * Creates a source that attempts multiple providers in deterministic order.
 */
export function createFallbackXSource(
  options: XFallbackSourceOptions,
): XFeedSource {
  const sources = resolveSources(options?.sources)
  const fallbackOnEmpty = resolveBoolean(
    options?.fallbackOnEmpty,
    false,
    'fallbackOnEmpty',
  )

  const includesExperimentalSource = sources.some(
    (source) => getXFeedSourceMetadata(source).stability === 'experimental',
  )

  return {
    id: FALLBACK_SOURCE_ID,
    metadata: {
      kind: 'fallback',
      stability: 'composite',
      label: 'X source fallback chain',
      official: null,
      warning: includesExperimentalSource
        ? 'This fallback chain includes experimental X sources. Monitor failed attempts and stale-cache usage.'
        : null,
    },
    async fetchPosts(context) {
      const errors: XFeedError[] = []

      for (const [index, source] of sources.entries()) {
        if (context.signal.aborted) {
          throw new XFeedError(
            'REQUEST_ABORTED',
            'X fallback source was aborted.',
            { sourceId: FALLBACK_SOURCE_ID },
          )
        }

        try {
          const posts = await source.fetchPosts(cloneContext(context))

          if (!Array.isArray(posts)) {
            throw new XFeedError(
              'INVALID_RESPONSE',
              `X feed source "${source.id}" returned a non-array payload.`,
              { sourceId: source.id },
            )
          }

          if (posts.length === 0 && fallbackOnEmpty) {
            options.onAttempt?.({
              sourceId: source.id,
              index,
              outcome: 'empty',
              error: null,
            })
            continue
          }

          options.onAttempt?.({
            sourceId: source.id,
            index,
            outcome: 'success',
            error: null,
          })
          return posts
        } catch (error) {
          const normalizedError = normalizeAttemptError(error, source.id)
          errors.push(normalizedError)
          options.onAttempt?.({
            sourceId: source.id,
            index,
            outcome: 'error',
            error: normalizedError,
          })
        }
      }

      throw new XFeedError(
        'REQUEST_FAILED',
        'All configured X feed sources failed.',
        {
          cause: new AggregateError(errors, 'X feed fallback exhausted.'),
          sourceId: FALLBACK_SOURCE_ID,
        },
      )
    },
  }
}

function resolveSources(value: readonly XFeedSource[] | undefined): XFeedSource[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new XFeedError(
      'INVALID_CONFIGURATION',
      'At least one X feed source is required.',
      { sourceId: FALLBACK_SOURCE_ID },
    )
  }

  const sources = value.map((source) => assertXFeedSource(source))
  const ids = new Set<string>()

  for (const source of sources) {
    if (source.id === FALLBACK_SOURCE_ID) {
      throw new XFeedError(
        'INVALID_CONFIGURATION',
        'A fallback source cannot contain itself.',
        { sourceId: FALLBACK_SOURCE_ID },
      )
    }

    if (ids.has(source.id)) {
      throw new XFeedError(
        'INVALID_CONFIGURATION',
        `Duplicate X feed source id "${source.id}".`,
        { sourceId: FALLBACK_SOURCE_ID },
      )
    }

    ids.add(source.id)
  }

  return sources
}

function cloneContext(context: XFeedSourceContext): XFeedSourceContext {
  return {
    config: { ...context.config },
    signal: context.signal,
    sinceId: context.sinceId,
  }
}

function normalizeAttemptError(error: unknown, sourceId: string): XFeedError {
  if (error instanceof XFeedError) {
    return error
  }

  return new XFeedError(
    'REQUEST_FAILED',
    `X feed source "${sourceId}" failed.`,
    { cause: error, sourceId },
  )
}

function resolveBoolean(
  value: boolean | undefined,
  fallback: boolean,
  field: string,
): boolean {
  if (value === undefined) {
    return fallback
  }

  if (typeof value !== 'boolean') {
    throw new XFeedError(
      'INVALID_CONFIGURATION',
      `${field} must be a boolean.`,
      { sourceId: FALLBACK_SOURCE_ID },
    )
  }

  return value
}
