'use client'

export type InstagramFeedMonitorActionState =
  | 'idle'
  | 'refreshing'
  | 'queueing'
  | 'queued'
  | 'running'
  | 'success'
  | 'error'

export interface RegenerateInstagramFeedButtonProps {
  state: InstagramFeedMonitorActionState
  message: string | null
  onRefresh: () => void
  onRegenerate: () => void
}

export function RegenerateInstagramFeedButton({
  state,
  message,
  onRefresh,
  onRegenerate,
}: RegenerateInstagramFeedButtonProps) {
  const busy =
    state === 'refreshing' ||
    state === 'queueing' ||
    state === 'queued' ||
    state === 'running'

  return (
    <div className="dss-instagram-monitor-actions">
      <button
        className="dss-instagram-monitor-button dss-instagram-monitor-button--secondary"
        type="button"
        onClick={onRefresh}
        disabled={busy}
      >
        {state === 'refreshing'
          ? 'Refreshing…'
          : 'Refresh status'}
      </button>

      <button
        className="dss-instagram-monitor-button dss-instagram-monitor-button--primary"
        type="button"
        onClick={onRegenerate}
        disabled={busy}
      >
        {state === 'queueing'
          ? 'Queueing…'
          : state === 'queued'
            ? 'Queued'
            : state === 'running'
              ? 'Synchronizing…'
              : 'Regenerate cache'}
      </button>

      <span
        className="dss-instagram-monitor-action-message"
        role="status"
        aria-live="polite"
      >
        {message}
      </span>
    </div>
  )
}
