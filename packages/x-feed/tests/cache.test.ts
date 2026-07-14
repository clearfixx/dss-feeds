import { describe, expect, it } from 'vitest'

import {
  createMemoryXFeedSnapshotStore,
  createXFeedCacheKey,
  createXPostChecksum,
  findLatestXPostId,
  mergeXPosts,
  readXFeedSnapshot,
  resolveXFeedCachePolicy,
  type XFeedSnapshot,
  type XFeedSnapshotStore,
  type XPost,
} from '../src/index.js'

describe('X feed cache core', () => {
  it('creates deterministic normalized cache keys', () => {
    expect(createXFeedCacheKey(' @DSS_Feeds ')).toBe('x:dss_feeds')
  })

  it('resolves cache policy defaults and rejects unsafe durations', () => {
    expect(resolveXFeedCachePolicy()).toEqual({
      freshForMs: 5_400_000,
      staleForMs: 86_400_000,
      syncIntervalMs: 3_600_000,
    })

    expect(() => resolveXFeedCachePolicy({ freshForMs: 1 })).toThrow(
      'freshForMs',
    )
  })

  it('creates deterministic change-detection checksums', () => {
    const posts = [fixturePost('101', '2026-07-14T10:00:00.000Z')]
    const same = structuredClone(posts)
    const changed = structuredClone(posts)
    changed[0]!.text = 'Changed text'

    expect(createXPostChecksum(posts)).toBe(createXPostChecksum(same))
    expect(createXPostChecksum(posts)).not.toBe(
      createXPostChecksum(changed),
    )
  })

  it('merges incremental posts without downgrading rich cached fields', () => {
    const cached = fixturePost('101', '2026-07-14T10:00:00.000Z')
    cached.author.id = '999'
    cached.metrics.likes = 42
    cached.media = [
      {
        key: 'media-1',
        type: 'photo',
        url: 'https://pbs.twimg.com/media/example.jpg',
        previewImageUrl: null,
        altText: null,
        width: null,
        height: null,
        durationMs: null,
      },
    ]

    const rssVersion = fixturePost('101', '2026-07-14T10:00:00.000Z')
    rssVersion.author.id = null
    rssVersion.metrics.likes = 0
    rssVersion.media = []

    const merged = mergeXPosts([cached], [rssVersion], 10)

    expect(merged[0]?.author.id).toBe('999')
    expect(merged[0]?.metrics.likes).toBe(42)
    expect(merged[0]?.media).toHaveLength(1)
  })

  it('finds the numerically newest X post ID', () => {
    expect(
      findLatestXPostId([
        fixturePost('99', '2026-07-14T12:00:00.000Z'),
        fixturePost('101', '2026-07-13T12:00:00.000Z'),
        fixturePost('100', '2026-07-15T12:00:00.000Z'),
      ]),
    ).toBe('101')
  })

  it('reads fresh, stale, and expired snapshots safely', async () => {
    const store = createMemoryXFeedSnapshotStore([
      fixtureSnapshot('2026-07-14T11:00:00.000Z', '2026-07-14T12:00:00.000Z'),
    ])

    await expect(
      readXFeedSnapshot({
        store,
        key: 'x:dss_feeds',
        now: new Date('2026-07-14T10:30:00.000Z'),
      }),
    ).resolves.toMatchObject({ state: 'fresh', renderable: true })

    await expect(
      readXFeedSnapshot({
        store,
        key: 'x:dss_feeds',
        now: new Date('2026-07-14T11:30:00.000Z'),
      }),
    ).resolves.toMatchObject({ state: 'stale', renderable: true })

    await expect(
      readXFeedSnapshot({
        store,
        key: 'x:dss_feeds',
        now: new Date('2026-07-14T12:30:00.000Z'),
      }),
    ).resolves.toMatchObject({
      state: 'expired',
      renderable: false,
      posts: [],
    })
  })

  it('distinguishes malformed storage from an unavailable store', async () => {
    const invalidStore: XFeedSnapshotStore = {
      async read() {
        return { schemaVersion: 999 }
      },
      async write() {},
    }
    const unavailableStore: XFeedSnapshotStore = {
      async read() {
        throw new Error('database unavailable')
      },
      async write() {},
    }

    await expect(
      readXFeedSnapshot({ store: invalidStore, key: 'x:dss_feeds' }),
    ).resolves.toMatchObject({ state: 'invalid' })
    await expect(
      readXFeedSnapshot({ store: unavailableStore, key: 'x:dss_feeds' }),
    ).resolves.toMatchObject({ state: 'unavailable' })
  })

  it('keeps memory store snapshots isolated from external mutation', async () => {
    const initial = fixtureSnapshot(
      '2026-07-14T11:00:00.000Z',
      '2026-07-14T12:00:00.000Z',
    )
    const store = createMemoryXFeedSnapshotStore([initial])
    initial.posts[0]!.text = 'Mutated outside the store'

    const stored = store.inspect('x:dss_feeds')
    expect(stored?.posts[0]?.text).toBe('Post 101')

    const read = (await store.read('x:dss_feeds')) as XFeedSnapshot
    read.posts[0]!.text = 'Mutated read clone'
    expect(store.inspect('x:dss_feeds')?.posts[0]?.text).toBe('Post 101')
  })
})

function fixtureSnapshot(
  freshUntil: string,
  staleUntil: string,
): XFeedSnapshot {
  const posts = [fixturePost('101', '2026-07-14T10:00:00.000Z')]
  return {
    schemaVersion: 1,
    key: 'x:dss_feeds',
    username: 'dss_feeds',
    posts,
    checksum: createXPostChecksum(posts),
    source: {
      id: 'fixture',
      kind: 'custom',
      stability: 'unknown',
      label: 'fixture',
      official: null,
      warning: null,
    },
    adapterVersion: '0.0.0',
    generatedAt: '2026-07-14T10:00:00.000Z',
    freshUntil,
    staleUntil,
    nextSyncAt: '2026-07-14T11:00:00.000Z',
    warnings: [],
  }
}

function fixturePost(id: string, createdAt: string): XPost {
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
  }
}
