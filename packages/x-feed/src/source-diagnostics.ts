import {
  XFeedError,
  type XFeedSource,
  type XFeedSourceAttemptDiagnostic,
  type XFeedSourceRunDiagnostics,
} from './types.js'

export function readXFeedSourceRunDiagnostics(
  source: XFeedSource,
  error?: unknown,
): XFeedSourceRunDiagnostics {
  const diagnostics = source.getLastRunDiagnostics?.()
  if (diagnostics) {
    return cloneDiagnostics(diagnostics)
  }

  const normalizedError = error instanceof XFeedError ? error : null
  const attempt: XFeedSourceAttemptDiagnostic = {
    sourceId: source.id,
    index: 0,
    outcome: error ? 'error' : 'success',
    errorCode: normalizedError?.code ?? null,
    status: normalizedError?.status ?? null,
  }

  return {
    requestedSourceId: source.id,
    selectedSourceId: error ? null : source.id,
    degraded: Boolean(error),
    attempts: [attempt],
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
