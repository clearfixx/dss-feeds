'use client'

import {
  useEffect,
  useRef,
  useState,
} from 'react'

export interface RegenerateGitHubFeedButtonProps {
  endpointURL: string
}

type ActionState =
  | 'idle'
  | 'queueing'
  | 'queued'
  | 'error'

export function RegenerateGitHubFeedButton({
  endpointURL,
}: RegenerateGitHubFeedButtonProps) {
  const [state, setState] =
    useState<ActionState>('idle')
  const [message, setMessage] =
    useState<string | null>(null)
  const reloadTimer =
    useRef<
      ReturnType<typeof setTimeout>
      | null
    >(null)

  useEffect(() => {
    return () => {
      if (reloadTimer.current) {
        clearTimeout(
          reloadTimer.current,
        )
      }
    }
  }, [])

  async function queueSynchronization() {
    setState('queueing')
    setMessage(
      'Queueing cache regeneration…',
    )

    try {
      const response = await fetch(
        endpointURL,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
          },
        },
      )

      if (!response.ok) {
        throw new Error(
          `Queue request failed with HTTP ${response.status}.`,
        )
      }

      setState('queued')
      setMessage(
        'Synchronization queued. Refreshing monitor…',
      )

      reloadTimer.current = setTimeout(
        () => {
          window.location.reload()
        },
        1800,
      )
    } catch {
      setState('error')
      setMessage(
        'Unable to queue synchronization.',
      )
    }
  }

  return (
    <div className="dss-github-monitor-actions">
      <button
        className="dss-github-monitor-button dss-github-monitor-button--secondary"
        type="button"
        onClick={() =>
          window.location.reload()
        }
        disabled={state === 'queueing'}
      >
        Refresh status
      </button>

      <button
        className="dss-github-monitor-button"
        type="button"
        onClick={
          queueSynchronization
        }
        disabled={
          state === 'queueing' ||
          state === 'queued'
        }
      >
        {state === 'queueing'
          ? 'Queueing…'
          : state === 'queued'
            ? 'Queued'
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
