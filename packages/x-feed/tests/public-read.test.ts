import { describe, expect, it } from 'vitest'

import {
  createXPostChecksum,
  readXFeedPublic,
  type XFeedSnapshot,
  type XPost,
} from '../src/index.js'

describe('public X feed reads', () => {
  it('creates a browser-safe view model without private cache fields', async () => {
    const result = await readXFeedPublic({
      store: fixtureStore(fixtureSnapshot()),
      username: '@DSS_FEEDS',
      now: new Date('2026-07-14T10:30:00.000Z'),
    })

    expect(result.state).toBe('fresh')
    expect(result.posts[0]).toMatchObject({
      id: '200',
      isReply: true,
      isQuote: false,
      isRepost: false,
      author: {
        username: 'dss_feeds',
        name: 'DSS Feeds',
      },
    })
    expect(result.posts[0]).not.toHaveProperty('conversationId')
    expect(result.posts[0]).not.toHaveProperty('references')
    expect(result.posts[0]?.author).not.toHaveProperty('id')
    expect(result).not.toHaveProperty('checksum')
    expect(result).not.toHaveProperty('source')
  })

  it('marks stale snapshots while keeping cached posts renderable', async () => {
    const result = await readXFeedPublic({
      store: fixtureStore(fixtureSnapshot()),
      username: 'dss_feeds',
      now: new Date('2026-07-14T12:00:00.000Z'),
    })

    expect(result.state).toBe('stale')
    expect(result.stale).toBe(true)
    expect(result.renderable).toBe(true)
    expect(result.posts).toHaveLength(2)
  })

  it('does not expose expired posts', async () => {
    const result = await readXFeedPublic({
      store: fixtureStore(fixtureSnapshot()),
      username: 'dss_feeds',
      now: new Date('2026-07-16T12:00:00.000Z'),
    })

    expect(result.state).toBe('expired')
    expect(result.renderable).toBe(false)
    expect(result.posts).toEqual([])
    expect(result.cachedPostCount).toBe(2)
  })

  it('returns an empty state for a missing snapshot', async () => {
    const result = await readXFeedPublic({
      store: fixtureStore(null),
      username: 'dss_feeds',
    })

    expect(result).toMatchObject({
      state: 'empty',
      renderable: false,
      stale: false,
      cachedPostCount: 0,
      posts: [],
    })
  })

  it('supports explicit cache keys', async () => {
    const result = await readXFeedPublic({
      store: fixtureStore(fixtureSnapshot()),
      key: 'x:dss_feeds',
      now: new Date('2026-07-14T10:30:00.000Z'),
    })

    expect(result.posts).toHaveLength(2)
  })

  it('forwards ordering and post limits to cache reads', async () => {
    const result = await readXFeedPublic({
      store: fixtureStore(fixtureSnapshot()),
      username: 'dss_feeds',
      order: 'asc',
      postCount: 1,
      now: new Date('2026-07-14T10:30:00.000Z'),
    })

    expect(result.posts.map((post) => post.id)).toEqual(['100'])
  })

  it('copies metrics and media into the public boundary', async () => {
    const result = await readXFeedPublic({
      store: fixtureStore(fixtureSnapshot()),
      username: 'dss_feeds',
      now: new Date('2026-07-14T10:30:00.000Z'),
    })

    const post = result.posts[0]
    expect(post?.metrics.likes).toBe(4)
    expect(post?.media[0]).toEqual({
      type: 'photo',
      url: 'https://cdn.example.test/photo.jpg',
      previewImageUrl: null,
      altText: 'A neutral test image',
      width: 1200,
      height: 800,
      durationMs: null,
    })
  })

  it('rejects malformed public cache keys before reading storage', async () => {
    await expect(
      readXFeedPublic({
        store: fixtureStore(null),
        key: 'not a valid key',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' })
  })
})

function fixtureStore(snapshot: unknown) {
  return {
    async read() {
      return snapshot
    },
    async write() {},
  }
}

function fixtureSnapshot(): XFeedSnapshot {
  const posts = [
    fixturePost('200', '2026-07-14T10:00:00.000Z', 'replied_to'),
    fixturePost('100', '2026-07-13T10:00:00.000Z'),
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

function fixturePost(
  id: string,
  createdAt: string,
  referenceType?: 'replied_to' | 'quoted' | 'reposted',
): XPost {
  return {
    id,
    source: 'x',
    kind: 'post',
    url: `https://x.com/dss_feeds/status/${id}`,
    text: `Post ${id}`,
    createdAt,
    language: 'en',
    conversationId: id,
    author: {
      id: '999',
      username: 'dss_feeds',
      name: 'DSS Feeds',
      profileImageUrl: 'https://cdn.example.test/avatar.jpg',
      verified: true,
      protected: false,
    },
    metrics: {
      replies: 1,
      reposts: 2,
      likes: 4,
      quotes: 1,
      bookmarks: 3,
      impressions: 100,
    },
    media:
      id === '200'
        ? [
            {
              key: 'media-1',
              type: 'photo',
              url: 'https://cdn.example.test/photo.jpg',
              previewImageUrl: null,
              altText: 'A neutral test image',
              width: 1200,
              height: 800,
              durationMs: null,
            },
          ]
        : [],
    references: referenceType
      ? [{ type: referenceType, postId: '50' }]
      : [],
  }
}
