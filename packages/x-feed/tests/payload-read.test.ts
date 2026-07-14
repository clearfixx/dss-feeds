import { describe, expect, it, vi } from 'vitest'

import {
  createXPostChecksum,
  type XFeedSnapshot,
} from '../src/index.js'
import { readPayloadXFeed } from '../src/payload/index.js'

describe('Payload public X feed reads', () => {
  it('reads a validated public feed by username', async () => {
    const snapshot = fixtureSnapshot()
    const find = vi.fn(async () => ({ docs: [{ id: 1, snapshot }] }))

    const result = await readPayloadXFeed({
      payload: { find } as never,
      username: '@DSS_FEEDS',
      now: new Date('2026-07-14T10:30:00.000Z'),
    })

    expect(result.posts[0]?.id).toBe('100')
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'dss-x-feed-cache',
        where: { key: { equals: 'x:dss_feeds' } },
      }),
    )
  })

  it('supports a custom Payload cache collection and key', async () => {
    const snapshot = fixtureSnapshot()
    const find = vi.fn(async () => ({ docs: [{ id: 1, snapshot }] }))

    await readPayloadXFeed({
      payload: { find } as never,
      collectionSlug: 'custom-x-cache',
      cacheKey: 'x:dss_feeds',
      now: new Date('2026-07-14T10:30:00.000Z'),
    })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'custom-x-cache' }),
    )
  })

  it('returns an empty public result when Payload has no snapshot', async () => {
    const result = await readPayloadXFeed({
      payload: {
        find: vi.fn(async () => ({ docs: [] })),
      } as never,
      username: 'dss_feeds',
    })

    expect(result).toMatchObject({
      state: 'empty',
      renderable: false,
      posts: [],
    })
  })

  it('forwards post limits without exposing persisted metadata', async () => {
    const snapshot = fixtureSnapshot()
    const result = await readPayloadXFeed({
      payload: {
        find: vi.fn(async () => ({ docs: [{ id: 1, snapshot }] })),
      } as never,
      username: 'dss_feeds',
      postCount: 1,
      now: new Date('2026-07-14T10:30:00.000Z'),
    })

    expect(result.posts).toHaveLength(1)
    expect(result).not.toHaveProperty('checksum')
  })
})

function fixtureSnapshot(): XFeedSnapshot {
  const posts = [
    {
      id: '100',
      source: 'x' as const,
      kind: 'post' as const,
      url: 'https://x.com/dss_feeds/status/100',
      text: 'Cached post',
      createdAt: '2026-07-14T10:00:00.000Z',
      language: 'en',
      conversationId: '100',
      author: {
        id: '999',
        username: 'dss_feeds',
        name: 'DSS Feeds',
        profileImageUrl: null,
        verified: null,
        protected: false,
      },
      metrics: {
        replies: 0,
        reposts: 0,
        likes: 0,
        quotes: 0,
        bookmarks: null,
        impressions: null,
      },
      media: [],
      references: [],
    },
  ]

  return {
    schemaVersion: 1,
    key: 'x:dss_feeds',
    username: 'dss_feeds',
    posts,
    checksum: createXPostChecksum(posts),
    source: {
      id: 'official',
      kind: 'official-api',
      stability: 'stable',
      label: 'Official X API',
      official: true,
      warning: null,
    },
    adapterVersion: '0.0.0',
    generatedAt: '2026-07-14T10:00:00.000Z',
    freshUntil: '2026-07-14T11:00:00.000Z',
    staleUntil: '2026-07-15T11:00:00.000Z',
    nextSyncAt: '2026-07-14T11:00:00.000Z',
    warnings: [],
  }
}
