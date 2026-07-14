'use client'

export type GitHubFeedMonitorActionState =
  | 'idle'
  | 'refreshing'
  | 'queueing'
  | 'queued'
  | 'running'
  | 'success'
  | 'error'

export interface RegenerateGitHubFeedButtonProps {
  state: GitHubFeedMonitorActionState
  message: string | null
  onRefresh: () => void
  onRegenerate: () => void
}

export function RegenerateGitHubFeedButton({
  state,
  message,
  onRefresh,
  onRegenerate,
}: RegenerateGitHubFeedButtonProps) {
  const busy =
    state === 'refreshing' ||
    state === 'queueing' ||
    state === 'queued' ||
    state === 'running'

  return (
    <div className="dss-github-monitor-actions">
      <button
        className="dss-github-monitor-button dss-github-monitor-button--secondary"
        type="button"
        onClick={onRefresh}
        disabled={busy}
      >
        {state === 'refreshing'
          ? 'Refreshing…'
          : 'Refresh status'}
      </button>

      <button
        className="dss-github-monitor-button dss-github-monitor-button--primary"
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
        className="dss-github-monitor-action-message"
        role="status"
        aria-live="polite"
      >
        {message}
      </span>
    </div>
  )
}
