'use client'

export type XFeedMonitorActionState =
  | 'idle'
  | 'refreshing'
  | 'queueing'
  | 'queued'
  | 'running'
  | 'success'
  | 'error'

export interface XFeedMonitorActionsProps {
  state: XFeedMonitorActionState
  message: string | null
  onRefresh: () => void
  onRegenerate: () => void
}

export function XFeedMonitorActions({
  state,
  message,
  onRefresh,
  onRegenerate,
}: XFeedMonitorActionsProps) {
  const busy =
    state === 'refreshing' ||
    state === 'queueing' ||
    state === 'queued' ||
    state === 'running'

  return (
    <div className="dss-x-admin__actions">
      <button
        className="dss-x-admin__button dss-x-admin__button--secondary"
        disabled={busy}
        type="button"
        onClick={onRefresh}
      >
        {state === 'refreshing' ? 'Refreshing…' : 'Refresh status'}
      </button>
      <button
        className="dss-x-admin__button"
        disabled={busy}
        type="button"
        onClick={onRegenerate}
      >
        {state === 'queueing'
          ? 'Queueing…'
          : state === 'queued'
            ? 'Queued'
            : state === 'running'
              ? 'Synchronizing…'
              : 'Regenerate cache'}
      </button>
      {message ? (
        <p className="dss-x-admin__action-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}
