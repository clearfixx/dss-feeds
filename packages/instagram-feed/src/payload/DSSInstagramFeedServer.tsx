import type { ReactNode } from 'react'
import type { Payload } from 'payload'
import { DSSInstagramFeed, type DSSInstagramFeedProps } from '../component/DSSInstagramFeed.js'
import { readInstagramFeed } from './read.js'

export interface DSSInstagramFeedServerProps extends Omit<DSSInstagramFeedProps, 'posts'> {
  payload: Payload
  cacheSlug?: string
  cacheKey?: string
}

export async function DSSInstagramFeedServer({
  payload,
  cacheSlug,
  cacheKey,
  postCount,
  ...props
}: DSSInstagramFeedServerProps): Promise<ReactNode> {
  const snapshot = await readInstagramFeed({ payload, cacheSlug, cacheKey, postLimit: postCount })
  return <DSSInstagramFeed {...props} postCount={postCount} posts={snapshot.posts} />
}
