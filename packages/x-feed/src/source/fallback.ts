import { assertXFeedSource } from '../security.js'
import { getXFeedSourceMetadata } from '../source-metadata.js'
import {
  XFeedError,
  type XFeedSource,
  type XFeedSourceAttemptDiagnostic,
  type XFeedSourceContext,
  type XFeedSourceRunDiagnostics,
} from '../types.js'

const FALLBACK_SOURCE_ID = 'x-fallback'

export interface XFallbackAttemptInfo {
  sourceId: string
  index: number
  outcome: 'success' | 'empty' | 'error'
  error: XFeedError | null
}

export interface XFallbackSourceOptions {
  /** Sources are attempted in order. */
  sources: readonly XFeedSource[]
  /**
   * Continue to the next source when a source returns no posts.
   * Disabled by default so an incremental sync with no new posts does not
   * accidentally fall through to a paid provider.
   */
  fallbackOnEmpty?: boolean
  /** Optional diagnostics hook for every attempted source. */
  onAttempt?: (info: XFallbackAttemptInfo) => void
}

/** Creates a source that attempts multiple providers in deterministic order. */
export function createFallbackXSource(
  options: XFallbackSourceOptions,
): XFeedSource {
  const sources = resolveSources(options?.sources)
  const fallbackOnEmpty = resolveBoolean(
    options?.fallbackOnEmpty,
    false,
    'fallbackOnEmpty',
  )
  let lastDiagnostics: XFeedSourceRunDiagnostics | null = null

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
    getLastRunDiagnostics() {
      return lastDiagnostics ? cloneDiagnostics(lastDiagnostics) : null
    },
    async fetchPosts(context) {
      const errors: XFeedError[] = []
      const attempts: XFeedSourceAttemptDiagnostic[] = []
      lastDiagnostics = createDiagnostics(attempts, null)

      for (const [index, source] of sources.entries()) {
        if (context.signal.aborted) {
          const error = new XFeedError(
            'REQUEST_ABORTED',
            'X fallback source was aborted.',
            { sourceId: FALLBACK_SOURCE_ID },
          )
          lastDiagnostics = createDiagnostics(attempts, null)
          throw error
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

          const outcome = posts.length === 0 ? 'empty' : 'success'
          attempts.push({
            sourceId: source.id,
            index,
            outcome,
            errorCode: null,
            status: null,
          })

          if (posts.length === 0 && fallbackOnEmpty) {
            options.onAttempt?.({
              sourceId: source.id,
              index,
              outcome: 'empty',
              error: null,
            })
            lastDiagnostics = createDiagnostics(attempts, null)
            continue
          }

          options.onAttempt?.({
            sourceId: source.id,
            index,
            outcome,
            error: null,
          })
          lastDiagnostics = createDiagnostics(attempts, source.id)
          return posts
        } catch (error) {
          const normalizedError = normalizeAttemptError(error, source.id)
          errors.push(normalizedError)
          attempts.push({
            sourceId: source.id,
            index,
            outcome: 'error',
            errorCode: normalizedError.code,
            status: normalizedError.status,
          })
          options.onAttempt?.({
            sourceId: source.id,
            index,
            outcome: 'error',
            error: normalizedError,
          })
          lastDiagnostics = createDiagnostics(attempts, null)
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

function createDiagnostics(
  attempts: readonly XFeedSourceAttemptDiagnostic[],
  selectedSourceId: string | null,
): XFeedSourceRunDiagnostics {
  return {
    requestedSourceId: FALLBACK_SOURCE_ID,
    selectedSourceId,
    degraded:
      attempts.some((attempt) => attempt.outcome === 'error') ||
      (selectedSourceId === null
        ? attempts.length > 0
        : attempts.length > 1),
    attempts: attempts.map((attempt) => ({ ...attempt })),
  }
}

function cloneDiagnostics(
  diagnostics: XFeedSourceRunDiagnostics,
): XFeedSourceRunDiagnostics {
  return {
    requestedSourceId: diagnostics.requestedSourceId,
    selectedSourceId: diagnostics.selectedSourceId,
    degraded: diagnostics.degraded,
    attempts: diagnostics.attempts.map((attempt) => ({ ...attempt })),
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
