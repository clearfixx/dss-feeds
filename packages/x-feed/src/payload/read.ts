import type { Payload } from 'payload'

import {
  readXFeedPublic,
  type XFeedPublicResult,
} from '../public.js'
import { createPayloadXFeedSnapshotStore } from './cache.js'

interface ReadPayloadXFeedBaseOptions {
  payload: Payload
  collectionSlug?: string
  postCount?: number
  order?: 'asc' | 'desc'
  now?: Date
}

export type ReadPayloadXFeedOptions =
  | (ReadPayloadXFeedBaseOptions & {
      username: string
      cacheKey?: never
    })
  | (ReadPayloadXFeedBaseOptions & {
      cacheKey: string
      username?: never
    })

export async function readPayloadXFeed(
  options: ReadPayloadXFeedOptions,
): Promise<XFeedPublicResult> {
  const store = createPayloadXFeedSnapshotStore({
    payload: options.payload,
    ...(options.collectionSlug
      ? { collectionSlug: options.collectionSlug }
      : {}),
  })
  const common = {
    store,
    ...(options.postCount === undefined
      ? {}
      : { postCount: options.postCount }),
    ...(options.order === undefined ? {} : { order: options.order }),
    ...(options.now === undefined ? {} : { now: options.now }),
  }

  if ('username' in options && typeof options.username === 'string') {
    return readXFeedPublic({ ...common, username: options.username })
  }

  return readXFeedPublic({ ...common, key: options.cacheKey })
}
