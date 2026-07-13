import type {
  ReactNode,
} from 'react'
import type { Payload } from 'payload'

import {
  DSSGitHubFeed,
  type DSSGitHubFeedProps,
} from '../component/DSSGitHubFeed.js'
import {
  readGitHubFeed,
} from './read.js'

export interface DSSGitHubFeedServerProps
  extends Omit<
    DSSGitHubFeedProps,
    'commits'
  > {
  payload: Payload
  cacheSlug?: string
  cacheKey?: string
  now?: Date
}

/**
 * Server-only convenience component.
 *
 * It reads the normalized Payload cache through Local API and then
 * delegates all presentation to the provider-neutral component.
 */
export async function DSSGitHubFeedServer({
  payload,
  cacheSlug,
  cacheKey,
  now,
  commitCount,
  repositories,
  order,
  emptyState = null,
  ...presentationProps
}: DSSGitHubFeedServerProps): Promise<ReactNode> {
  const result =
    await readGitHubFeed({
      payload,
      cacheSlug,
      cacheKey,
      now,
      commitCount,
      repositories,
      order,
    })

  if (!result.renderable) {
    return emptyState
  }

  return (
    <DSSGitHubFeed
      {...presentationProps}
      commits={result.commits}
      commitCount={commitCount}
      repositories={repositories}
      order={order}
      emptyState={emptyState}
    />
  )
}
