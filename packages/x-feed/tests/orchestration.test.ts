import { describe, expect, it } from 'vitest'

import {
  createMemoryXFeedMonitorStore,
  createMemoryXFeedRunLock,
  createMemoryXFeedSnapshotStore,
  executeXFeedSync,
  type XFeedSource,
  type XPost,
} from '../src/index.js'

describe('X feed sync orchestration', () => {
  it('executes a monitored synchronization and captures logs', async () => {
    const report = await executeXFeedSync({
      source: fixtureSource([fixturePost('100')]),
      snapshotStore: createMemoryXFeedSnapshotStore(),
      monitorStore: createMemoryXFeedMonitorStore(),
      trigger: 'manual',
      force: true,
      now: new Date('2026-07-14T10:00:00.000Z'),
      config: { username: 'dss_feeds', postLimit: 5 },
    })

    expect(report).toMatchObject({
      status: 'success',
      trigger: 'manual',
      cachedPostCount: 1,
      selectedSourceId: 'fixture',
      monitor: { status: 'healthy' },
    })
    expect(report.logs.length).toBeGreaterThan(0)
  })

  it('skips a second concurrent run for the same lock key', async () => {
    const lock = createMemoryXFeedRunLock()
    let releaseFetch!: () => void
    const waiting = new Promise<void>((resolve) => { releaseFetch = resolve })
    const source: XFeedSource = {
      id: 'fixture',
      async fetchPosts() {
        await waiting
        return [fixturePost('101')]
      },
    }
    const common = {
      source,
      snapshotStore: createMemoryXFeedSnapshotStore(),
      monitorStore: createMemoryXFeedMonitorStore(),
      trigger: 'schedule' as const,
      force: true,
      config: { username: 'dss_feeds', postLimit: 5 },
      lock,
      lockKey: 'dss-x-feed:test',
    }

    const first = executeXFeedSync(common)
    await Promise.resolve()
    const second = await executeXFeedSync(common)
    releaseFetch()
    await first

    expect(second).toMatchObject({ status: 'skipped', reason: 'locked' })
  })

  it('releases the single-flight lock after a provider failure', async () => {
    const lock = createMemoryXFeedRunLock()
    await executeXFeedSync({
      source: failingSource(),
      snapshotStore: createMemoryXFeedSnapshotStore(),
      monitorStore: createMemoryXFeedMonitorStore(),
      trigger: 'schedule',
      force: true,
      config: { username: 'dss_feeds' },
      lock,
      lockKey: 'dss-x-feed:test',
    }).catch(() => undefined)

    expect(lock.isLocked('dss-x-feed:test')).toBe(false)
  })

  it('reports not-due synchronization without provider traffic', async () => {
    const snapshots = createMemoryXFeedSnapshotStore()
    const monitor = createMemoryXFeedMonitorStore()
    const source = fixtureSource([fixturePost('102')])

    await executeXFeedSync({
      source, snapshotStore: snapshots, monitorStore: monitor,
      trigger: 'schedule', force: true,
      now: new Date('2026-07-14T10:00:00.000Z'),
      config: { username: 'dss_feeds' },
    })
    const report = await executeXFeedSync({
      source, snapshotStore: snapshots, monitorStore: monitor,
      trigger: 'schedule',
      now: new Date('2026-07-14T10:01:00.000Z'),
      config: { username: 'dss_feeds' },
    })

    expect(report).toMatchObject({ status: 'skipped', reason: 'not_due' })
  })

  it('rejects unsafe lock keys', async () => {
    await expect(executeXFeedSync({
      source: fixtureSource([]),
      snapshotStore: createMemoryXFeedSnapshotStore(),
      monitorStore: createMemoryXFeedMonitorStore(),
      trigger: 'manual',
      config: { username: 'dss_feeds' },
      lockKey: 'unsafe key',
    })).rejects.toThrow('lock key')
  })
})

function fixtureSource(posts: readonly XPost[]): XFeedSource {
  return { id: 'fixture', async fetchPosts() { return posts } }
}
function failingSource(): XFeedSource {
  return { id: 'broken', async fetchPosts() { throw new Error('unavailable') } }
}
function fixturePost(id: string): XPost {
  return {
    id, source: 'x', kind: 'post', url: `https://x.com/dss_feeds/status/${id}`,
    text: `Post ${id}`, createdAt: '2026-07-14T09:00:00.000Z', language: null,
    conversationId: null,
    author: { id: null, username: 'dss_feeds', name: 'DSS Feeds', profileImageUrl: null, verified: null, protected: null },
    metrics: { replies: 0, reposts: 0, likes: 0, quotes: 0, bookmarks: null, impressions: null },
    media: [], references: [],
  }
}
