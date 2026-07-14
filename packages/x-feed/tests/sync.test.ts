import { describe, expect, it } from 'vitest'

import {
  createMemoryXFeedSnapshotStore,
  synchronizeXFeed,
  XFeedError,
  type XFeedSnapshot,
  type XFeedSnapshotStore,
  type XFeedSource,
  type XPost,
} from '../src/index.js'

describe('synchronizeXFeed', () => {
  it('creates the first cache snapshot', async () => {
    const store = createMemoryXFeedSnapshotStore()
    const source = fixtureSource([
      fixturePost('101', '2026-07-14T10:00:00.000Z'),
    ])

    const result = await synchronizeXFeed({
      source,
      store,
      config: { username: '@dss_feeds', postLimit: 5 },
      now: new Date('2026-07-14T10:00:00.000Z'),
    })

    expect(result).toMatchObject({
      status: 'success',
      created: true,
      changed: true,
      incremental: false,
      fetchedPostCount: 1,
      cachedPostCount: 1,
    })
    expect(store.inspect('x:dss_feeds')?.username).toBe('dss_feeds')
  })

  it('skips synchronization while the snapshot is not due', async () => {
    const store = createMemoryXFeedSnapshotStore()
    let calls = 0
    const source: XFeedSource = {
      id: 'fixture',
      async fetchPosts() {
        calls += 1
        return [fixturePost('101', '2026-07-14T10:00:00.000Z')]
      },
    }

    await synchronizeXFeed({
      source,
      store,
      config: { username: 'dss_feeds' },
      now: new Date('2026-07-14T10:00:00.000Z'),
    })
    const result = await synchronizeXFeed({
      source,
      store,
      config: { username: 'dss_feeds' },
      now: new Date('2026-07-14T10:30:00.000Z'),
    })

    expect(result).toMatchObject({ status: 'skipped', reason: 'not_due' })
    expect(calls).toBe(1)
  })

  it('allows a forced synchronization before nextSyncAt', async () => {
    const store = createMemoryXFeedSnapshotStore()
    let calls = 0
    const source: XFeedSource = {
      id: 'fixture',
      async fetchPosts() {
        calls += 1
        return [fixturePost(String(100 + calls), '2026-07-14T10:00:00.000Z')]
      },
    }

    await synchronizeXFeed({
      source,
      store,
      config: { username: 'dss_feeds' },
      now: new Date('2026-07-14T10:00:00.000Z'),
    })
    await synchronizeXFeed({
      source,
      store,
      config: { username: 'dss_feeds' },
      now: new Date('2026-07-14T10:05:00.000Z'),
      force: true,
    })

    expect(calls).toBe(2)
  })

  it('uses sinceId and merges incremental posts', async () => {
    const store = createMemoryXFeedSnapshotStore()
    const seenSinceIds: Array<string | null> = []
    let call = 0
    const source: XFeedSource = {
      id: 'fixture',
      async fetchPosts({ sinceId }) {
        seenSinceIds.push(sinceId)
        call += 1
        return call === 1
          ? [fixturePost('101', '2026-07-14T10:00:00.000Z')]
          : [fixturePost('102', '2026-07-14T11:00:00.000Z')]
      },
    }

    await synchronizeXFeed({
      source,
      store,
      config: { username: 'dss_feeds', postLimit: 5 },
      now: new Date('2026-07-14T10:00:00.000Z'),
    })
    const result = await synchronizeXFeed({
      source,
      store,
      config: { username: 'dss_feeds', postLimit: 5 },
      now: new Date('2026-07-14T11:00:00.000Z'),
      force: true,
    })

    expect(seenSinceIds).toEqual([null, '101'])
    expect(result).toMatchObject({ incremental: true, sinceId: '101' })
    expect(store.inspect('x:dss_feeds')?.posts.map((post) => post.id)).toEqual([
      '102',
      '101',
    ])
  })

  it('retains cached posts when an incremental request returns empty', async () => {
    const store = createMemoryXFeedSnapshotStore()
    let call = 0
    const source: XFeedSource = {
      id: 'fixture',
      async fetchPosts() {
        call += 1
        return call === 1
          ? [fixturePost('101', '2026-07-14T10:00:00.000Z')]
          : []
      },
    }

    await synchronizeXFeed({
      source,
      store,
      config: { username: 'dss_feeds' },
      now: new Date('2026-07-14T10:00:00.000Z'),
    })
    const result = await synchronizeXFeed({
      source,
      store,
      config: { username: 'dss_feeds' },
      now: new Date('2026-07-14T11:00:00.000Z'),
      force: true,
    })

    expect(result).toMatchObject({
      changed: false,
      fetchedPostCount: 0,
      cachedPostCount: 1,
    })
    expect(store.inspect('x:dss_feeds')?.posts).toHaveLength(1)
  })

  it('preserves the previous snapshot when the source fails', async () => {
    const baseStore = createMemoryXFeedSnapshotStore()
    const source = fixtureSource([
      fixturePost('101', '2026-07-14T10:00:00.000Z'),
    ])

    await synchronizeXFeed({
      source,
      store: baseStore,
      config: { username: 'dss_feeds' },
      now: new Date('2026-07-14T10:00:00.000Z'),
    })
    const before = baseStore.inspect('x:dss_feeds')

    await expect(
      synchronizeXFeed({
        source: {
          id: 'failed-source',
          async fetchPosts() {
            throw new XFeedError('REQUEST_FAILED', 'provider failed')
          },
        },
        store: baseStore,
        config: { username: 'dss_feeds' },
        now: new Date('2026-07-14T11:00:00.000Z'),
        force: true,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_FAILED' })

    expect(baseStore.inspect('x:dss_feeds')).toEqual(before)
  })

  it('persists experimental source warnings for admin consumers', async () => {
    const store = createMemoryXFeedSnapshotStore()
    const source: XFeedSource = {
      id: 'experimental-source',
      metadata: {
        kind: 'rss-bridge',
        stability: 'experimental',
        label: 'Experimental RSS',
        official: false,
        warning: 'This source may stop working without notice.',
      },
      async fetchPosts() {
        return [fixturePost('101', '2026-07-14T10:00:00.000Z')]
      },
    }

    const result = await synchronizeXFeed({
      source,
      store,
      config: { username: 'dss_feeds' },
      now: new Date('2026-07-14T10:00:00.000Z'),
    })

    expect(result.warnings).toContain(
      'This source may stop working without notice.',
    )
    expect(store.inspect('x:dss_feeds')?.source.stability).toBe(
      'experimental',
    )
  })

  it('maps cache read failures without calling the provider', async () => {
    let providerCalled = false
    const store: XFeedSnapshotStore = {
      async read() {
        throw new Error('database offline')
      },
      async write() {},
    }

    await expect(
      synchronizeXFeed({
        source: {
          id: 'fixture',
          async fetchPosts() {
            providerCalled = true
            return []
          },
        },
        store,
        config: { username: 'dss_feeds' },
      }),
    ).rejects.toMatchObject({ code: 'CACHE_READ_FAILED' })

    expect(providerCalled).toBe(false)
  })

  it('maps cache write failures after a successful provider request', async () => {
    const receivedSnapshots: XFeedSnapshot[] = []
    const store: XFeedSnapshotStore = {
      async read() {
        return null
      },
      async write(snapshot) {
        receivedSnapshots.push(snapshot)
        throw new Error('database read-only')
      },
    }

    await expect(
      synchronizeXFeed({
        source: fixtureSource([
          fixturePost('101', '2026-07-14T10:00:00.000Z'),
        ]),
        store,
        config: { username: 'dss_feeds' },
      }),
    ).rejects.toMatchObject({ code: 'CACHE_WRITE_FAILED' })

    expect(receivedSnapshots[0]?.posts).toHaveLength(1)
  })
})

function fixtureSource(posts: readonly XPost[]): XFeedSource {
  return {
    id: 'fixture',
    async fetchPosts() {
      return posts
    },
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
